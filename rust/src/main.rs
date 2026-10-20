//! The demo's sender: a captured surface, encoded by the codec, and measured.
//!
//! The codec does the work. This binary is the *application* around it: it
//! paints a small synthetic screen, hands the capture to the codec's encoder,
//! splits the encoded update into the parts that travel on the wire, decodes
//! its own update with the codec's receiver oracle, and writes everything the
//! browser needs into one JSON document.
//!
//! Nothing here interprets the codec's rules: the encoder decides what an
//! update carries, the splitter decides how it is parted, and the oracle
//! decides what a receiver paints.

use std::fmt::Write as _;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tessellio_core::telemetry::{CodecEvent, EncodePhase, Telemetry};
use tessellio_core::{
    rgba_to_cells, CapturedFrame, CodecConfig, EncodedUpdate, ScreenStreamEncoder, Surface,
    SurfaceCanvas, UpdateSplitter,
};

/// The captured surface, in cells.
const WIDTH: u32 = 320;
const HEIGHT: u32 = 180;

/// What the sender captures: a small window with text lines in it.
fn paint_capture(phase: u32) -> Result<CapturedFrame, tessellio_core::CodecError> {
    let mut rgba = vec![0_u8; (WIDTH * HEIGHT * 4) as usize];
    fill(&mut rgba, 0, 0, WIDTH, HEIGHT, [18, 20, 26, 255]);
    fill(&mut rgba, 12, 10, 296, 150, [30, 33, 42, 255]);
    fill(&mut rgba, 12, 10, 296, 16, [46, 52, 66, 255]);
    for index in 0..3 {
        fill(&mut rgba, 20 + index * 10, 15, 6, 6, [120, 130, 150, 255]);
    }
    for line in 0..7 {
        let y = 36 + line * 12;
        let width = 120 + ((line * 37 + phase * 11) % 120) as u32;
        fill(&mut rgba, 24, y, width, 5, [188, 196, 212, 255]);
    }
    // A block that moves between the two captures: the change the second
    // update carries.
    let block_x = 200 + (phase % 4) * 12;
    fill(&mut rgba, block_x, 100, 40, 30, [235, 180, 90, 255]);
    CapturedFrame::new(WIDTH, HEIGHT, rgba)
}

/// Paint one rectangle of the capture.
fn fill(rgba: &mut [u8], x: u32, y: u32, width: u32, height: u32, colour: [u8; 4]) {
    for row in y..(y + height).min(HEIGHT) {
        for column in x..(x + width).min(WIDTH) {
            let offset = ((row * WIDTH + column) * 4) as usize;
            rgba[offset..offset + 4].copy_from_slice(&colour);
        }
    }
}

/// The encoder's own phase measurements.
#[derive(Debug, Default)]
struct PhaseLog {
    entries: Mutex<Vec<(EncodePhase, Duration)>>,
}

impl Telemetry for PhaseLog {
    fn record(&self, event: CodecEvent) {
        if let CodecEvent::PhaseElapsed { phase, elapsed } = event {
            let mut entries = self.entries.lock().unwrap_or_else(|error| error.into_inner());
            entries.push((phase, elapsed));
        }
    }
}

/// One measured update.
struct Measured {
    update: EncodedUpdate,
    encode: Duration,
    phases: Vec<(EncodePhase, Duration)>,
}

fn main() -> std::process::ExitCode {
    let mut out = String::from("public/artifact.json");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--out" => match args.next() {
                Some(path) => out = path,
                None => {
                    eprintln!("tessellio-demo: --out needs a path");
                    return std::process::ExitCode::FAILURE;
                }
            },
            other => {
                eprintln!("tessellio-demo: unknown argument {other}");
                return std::process::ExitCode::FAILURE;
            }
        }
    }
    match run(&out) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("tessellio-demo: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn run(out_path: &str) -> Result<(), String> {
    let log = Arc::new(PhaseLog::default());
    let mut encoder = ScreenStreamEncoder::with_telemetry(CodecConfig::default(), log.clone());

    // The first capture establishes the whole surface: a self-contained update.
    let first_capture = paint_capture(0).map_err(|error| error.to_string())?;
    let first = measure(&mut encoder, &first_capture, 1, &log)?;

    // The second capture moves one block: a chained update over the first.
    let second_capture = paint_capture(1).map_err(|error| error.to_string())?;
    let second = measure(&mut encoder, &second_capture, 2, &log)?;

    // The codec's own receiver oracle: what a receiver paints must equal the
    // capture the sender encoded.
    let mut canvas = SurfaceCanvas::new();
    canvas
        .apply(&first.update)
        .map_err(|error| format!("the first update does not apply: {error:?}"))?;
    canvas
        .apply(&second.update)
        .map_err(|error| format!("the second update does not apply: {error:?}"))?;
    let mut expected = Surface::new(WIDTH, HEIGHT).map_err(|error| error.to_string())?;
    rgba_to_cells(second_capture.rgba(), WIDTH, HEIGHT, &mut expected)
        .map_err(|error| format!("the capture does not convert: {error}"))?;
    if canvas.cells() != expected.as_u16() {
        return Err("the decoded surface differs from the capture".to_string());
    }

    let document = build_document(&first, &second, expected.as_u16())?;
    if let Some(parent) = std::path::Path::new(out_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("{} cannot be created: {error}", parent.display()))?;
    }
    std::fs::write(out_path, document)
        .map_err(|error| format!("{out_path} cannot be written: {error}"))?;
    println!(
        "MEASURE tessellio-demo: updates=2 reset_bytes={} delta_bytes={} \
         reset_encode_ms={:.3} delta_encode_ms={:.3} cells={} surface_ok=true",
        first.update.payload_bytes(),
        second.update.payload_bytes(),
        millis(first.encode),
        millis(second.encode),
        WIDTH * HEIGHT,
    );
    Ok(())
}

/// Encode one capture and commit it under `update_id`.
fn measure(
    encoder: &mut ScreenStreamEncoder,
    capture: &CapturedFrame,
    update_id: u64,
    log: &Arc<PhaseLog>,
) -> Result<Measured, String> {
    let before = log.entries.lock().unwrap_or_else(|error| error.into_inner()).len();
    let started = Instant::now();
    let planned = encoder
        .encode(capture)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("update {update_id} carries nothing"))?;
    let update = encoder.commit(planned, update_id);
    let encode = started.elapsed();
    let phases = log
        .entries
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .split_off(before);
    Ok(Measured {
        update,
        encode,
        phases,
    })
}

/// The JSON document the browser reads.
fn build_document(
    first: &Measured,
    second: &Measured,
    source: &[u16],
) -> Result<String, String> {
    let mut out = String::new();
    out.push_str("{\n");
    let _ = write!(out, "  \"codec\": \"tessellio\",\n");
    let _ = write!(out, "  \"width\": {WIDTH},\n");
    let _ = write!(out, "  \"height\": {HEIGHT},\n");
    let _ = write!(out, "  \"sourceCells\": \"{}\",\n", base64(&cell_bytes(source)));
    out.push_str("  \"updates\": [\n");
    for (index, measured) in [first, second].iter().enumerate() {
        write_update(&mut out, measured, index == 1)?;
    }
    out.push_str("  ]\n}\n");
    Ok(out)
}

/// One update, with its parts.
fn write_update(out: &mut String, measured: &Measured, last: bool) -> Result<(), String> {
    let update = &measured.update;
    let parts = UpdateSplitter::new()
        .part(update.clone())
        .map_err(|error| format!("update {} does not part: {error}", update.update_id))?;
    let _ = write!(out, "    {{\n");
    let _ = write!(out, "      \"updateId\": {},\n", update.update_id);
    let _ = write!(out, "      \"baseUpdateId\": {},\n", update.update_base);
    let _ = write!(out, "      \"kind\": \"{}\",\n", update.kind().as_str());
    let _ = write!(out, "      \"changedCells\": {},\n", update.changed_cells);
    let _ = write!(out, "      \"sentCells\": {},\n", update.sent_cells);
    let _ = write!(out, "      \"bytes\": {},\n", update.payload_bytes());
    let _ = write!(out, "      \"regions\": {},\n", update.regions.len());
    let _ = write!(out, "      \"parts\": {},\n", parts.len());
    let _ = write!(out, "      \"encodeMs\": {:.4},\n", millis(measured.encode));
    let _ = write!(out, "      \"phases\": [");
    for (index, (phase, elapsed)) in measured.phases.iter().enumerate() {
        if index > 0 {
            out.push_str(", ");
        }
        let _ = write!(
            out,
            "{{\"phase\": \"{}\", \"ms\": {:.4}}}",
            phase.as_str(),
            millis(*elapsed)
        );
    }
    out.push_str("],\n");
    out.push_str("      \"partList\": [\n");
    for (index, part) in parts.iter().enumerate() {
        let _ = write!(out, "        {{\n");
        let _ = write!(out, "          \"partIndex\": {},\n", part.part_index);
        let _ = write!(out, "          \"partCount\": {},\n", part.part_count);
        let _ = write!(out, "          \"updateBytes\": {},\n", part.update_bytes);
        out.push_str("          \"regions\": [\n");
        for (region_index, region) in part.regions.iter().enumerate() {
            let _ = write!(
                out,
                "            {{\"x\": {}, \"y\": {}, \"width\": {}, \"height\": {}, \"payload\": \"{}\"}}",
                region.x,
                region.y,
                region.width,
                region.height,
                base64(&region.payload)
            );
            if region_index + 1 < part.regions.len() {
                out.push(',');
            }
            out.push('\n');
        }
        out.push_str("          ]\n        }");
        if index + 1 < parts.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str("      ]\n    }");
    if !last {
        out.push(',');
    }
    out.push('\n');
    Ok(())
}

/// Milliseconds, as a float.
fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

/// The cells, as little-endian bytes.
fn cell_bytes(cells: &[u16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(cells.len() * 2);
    for cell in cells {
        bytes.extend_from_slice(&cell.to_le_bytes());
    }
    bytes
}

/// Base64, without a dependency.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        let triple = (u32::from(first) << 16) | (u32::from(second) << 8) | u32::from(third);
        out.push(char::from(ALPHABET[(triple >> 18) as usize & 0x3f]));
        out.push(char::from(ALPHABET[(triple >> 12) as usize & 0x3f]));
        if chunk.len() > 1 {
            out.push(char::from(ALPHABET[(triple >> 6) as usize & 0x3f]));
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(char::from(ALPHABET[triple as usize & 0x3f]));
        } else {
            out.push('=');
        }
    }
    out
}
