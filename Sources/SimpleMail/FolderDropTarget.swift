import SwiftUI
import AppKit

/// 2.34: Ablegeziel für Mails auf einem Ordner der Seitenleiste – direkt in AppKit.
/// SwiftUIs dropDestination/onDrop kamen in der Seitenleisten-Liste nie an (kein grünes Plus, Mail sprang zurück).
struct FolderDropTarget: NSViewRepresentable {
    /// false: nimmt nichts an (z. B. Einträge wie „Smart Inbox“)
    var enabled = true
    /// 2.40: beim Verweilen während des Ziehens (z. B. eingeklapptes Konto aufklappen)
    var onLinger: (@MainActor () -> Void)? = nil
    let onDrop: @MainActor (String) -> Bool

    func makeNSView(context: Context) -> FolderDropView {
        let v = FolderDropView()
        v.onDrop = enabled ? onDrop : nil
        v.onLinger = onLinger
        return v
    }

    func updateNSView(_ nsView: FolderDropView, context: Context) {
        nsView.onDrop = enabled ? onDrop : nil
        nsView.onLinger = onLinger
    }
}

/// 2.40: Fläche nur zum Mitscrollen (Kopfzeilen, nicht wählbare Ordner) – nimmt nichts an
struct SidebarScrollTarget: NSViewRepresentable {
    var onLinger: (@MainActor () -> Void)? = nil

    func makeNSView(context: Context) -> FolderDropView {
        let v = FolderDropView()
        v.onLinger = onLinger
        return v
    }

    func updateNSView(_ nsView: FolderDropView, context: Context) {
        nsView.onLinger = onLinger
    }
}

final class FolderDropView: NSView {
    var onDrop: (@MainActor (String) -> Bool)?
    var onLinger: (@MainActor () -> Void)?
    private var enteredAt: Date?
    private var lingerDone = false
    private var highlighted = false {
        didSet { if oldValue != highlighted { needsDisplay = true } }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.string])
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        registerForDraggedTypes([.string])
    }

    /// Klicks (Auswahl, Rechtsklick) gehen an die Liste darunter – nur beim Ziehen ist dieser Bereich Ziel
    override func hitTest(_ point: NSPoint) -> NSView? {
        if let type = NSApp.currentEvent?.type {
            switch type {
            case .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
                 .mouseMoved, .scrollWheel:
                return nil
            default:
                break
            }
        }
        return super.hitTest(point)
    }

    private func payload(_ info: NSDraggingInfo) -> String? {
        guard let s = info.draggingPasteboard.string(forType: .string), s.hasPrefix("simplemail-move|") else { return nil }
        return s
    }

    /// Beim Überfahren nur den Typ prüfen – der Inhalt wird von SwiftUI evtl. erst beim Ablegen geliefert
    private func offersText(_ info: NSDraggingInfo) -> Bool {
        onDrop != nil && info.draggingPasteboard.types?.contains(.string) == true
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        enteredAt = Date()
        lingerDone = false
        autoscroll(sender)
        guard offersText(sender) else { return [] }
        highlighted = true
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        autoscroll(sender)
        if !lingerDone, let start = enteredAt, Date().timeIntervalSince(start) > 0.7, let onLinger {
            lingerDone = true
            onLinger()
        }
        return offersText(sender) ? .copy : []
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        highlighted = false
        enteredAt = nil
    }

    /// 2.40: Maus am oberen/unteren Rand der Seitenleiste → Liste mitscrollen (AppKit ruft draggingUpdated
    /// auch ohne Mausbewegung regelmäßig auf, dadurch läuft das Scrollen weiter, solange die Maus am Rand bleibt)
    private func autoscroll(_ info: NSDraggingInfo) {
        guard let sv = enclosingScrollView, let doc = sv.documentView else { return }
        let clip = sv.contentView
        let p = clip.convert(info.draggingLocation, from: nil)
        let vis = clip.bounds
        let edge: CGFloat = 40
        let topInset = sv.contentInsets.top
        let distTop: CGFloat
        let distBottom: CGFloat
        if clip.isFlipped {
            distTop = p.y - (vis.minY + topInset)
            distBottom = vis.maxY - p.y
        } else {
            distTop = vis.maxY - topInset - p.y
            distBottom = p.y - vis.minY
        }
        var step: CGFloat = 0
        if distBottom < edge { step = max(4, (edge - distBottom) / 2) }
        else if distTop < edge { step = -max(4, (edge - distTop) / 2) }
        guard step != 0 else { return }
        var origin = vis.origin
        let minY = -topInset
        let maxY = max(minY, doc.frame.height - vis.height)
        if clip.isFlipped { origin.y += step } else { origin.y -= step }
        origin.y = min(max(origin.y, minY), maxY)
        guard origin.y != vis.origin.y else { return }
        clip.scroll(to: origin)
        sv.reflectScrolledClipView(clip)
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        offersText(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        highlighted = false
        guard let s = payload(sender), let onDrop else { return false }
        return onDrop(s)
    }

    override func concludeDragOperation(_ sender: NSDraggingInfo?) {
        highlighted = false
        enteredAt = nil
    }

    override func draw(_ dirtyRect: NSRect) {
        guard highlighted else { return }
        NSColor.controlAccentColor.withAlphaComponent(0.25).setFill()
        NSBezierPath(roundedRect: bounds.insetBy(dx: 1, dy: 0), xRadius: 5, yRadius: 5).fill()
    }
}
