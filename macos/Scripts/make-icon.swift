// Renders the app icon (RSS waves on a rounded gradient tile) at every size macOS wants and
// writes AppIcon.icns next to this script's output dir. Usage: swift Scripts/make-icon.swift <outdir>
import AppKit

let outDir = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "build")
let iconset = outDir.appendingPathComponent("AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try! FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func render(_ px: Int) -> NSImage {
    let s = CGFloat(px)
    let img = NSImage(size: NSSize(width: s, height: s))
    img.lockFocus()
    let ctx = NSGraphicsContext.current!.cgContext
    // macOS-style squircle with ~10% margin
    let inset = s * 0.09
    let rect = CGRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let path = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)
    ctx.saveGState()
    path.addClip()
    let grad = NSGradient(colors: [
        NSColor(calibratedRed: 1.00, green: 0.55, blue: 0.17, alpha: 1),
        NSColor(calibratedRed: 0.93, green: 0.30, blue: 0.15, alpha: 1),
    ])!
    grad.draw(in: rect, angle: -60)
    ctx.restoreGState()

    // Paper sheet (reading list) on the left
    let paper = CGRect(
        x: rect.minX + rect.width * 0.18, y: rect.minY + rect.height * 0.16,
        width: rect.width * 0.42, height: rect.height * 0.62)
    NSColor.white.withAlphaComponent(0.95).setFill()
    NSBezierPath(roundedRect: paper, xRadius: s * 0.03, yRadius: s * 0.03).fill()
    NSColor(calibratedRed: 0.93, green: 0.30, blue: 0.15, alpha: 0.55).setFill()
    for i in 0..<4 {
        let w = paper.width * (i == 0 ? 0.55 : 0.72)
        let line = CGRect(
            x: paper.minX + paper.width * 0.14,
            y: paper.maxY - paper.height * (0.22 + CGFloat(i) * 0.19),
            width: w, height: paper.height * 0.07)
        NSBezierPath(roundedRect: line, xRadius: line.height / 2, yRadius: line.height / 2).fill()
    }

    // RSS waves bottom-right
    let origin = CGPoint(x: rect.minX + rect.width * 0.62, y: rect.minY + rect.height * 0.20)
    NSColor.white.setStroke()
    NSColor.white.setFill()
    NSBezierPath(ovalIn: CGRect(x: origin.x - s * 0.045, y: origin.y - s * 0.045, width: s * 0.09, height: s * 0.09)).fill()
    for r in [0.16, 0.27] {
        let p = NSBezierPath()
        p.appendArc(withCenter: origin, radius: s * r, startAngle: 0, endAngle: 90)
        p.lineWidth = s * 0.075
        p.lineCapStyle = .round
        p.stroke()
    }
    img.unlockFocus()
    return img
}

func write(_ img: NSImage, _ name: String) {
    let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
    let png = rep.representation(using: .png, properties: [:])!
    try! png.write(to: iconset.appendingPathComponent(name))
}

for base in [16, 32, 128, 256, 512] {
    write(render(base), "icon_\(base)x\(base).png")
    write(render(base * 2), "icon_\(base)x\(base)@2x.png")
}

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", outDir.appendingPathComponent("AppIcon.icns").path]
try! task.run(); task.waitUntilExit()
print(task.terminationStatus == 0 ? "wrote \(outDir.path)/AppIcon.icns" : "iconutil failed")
