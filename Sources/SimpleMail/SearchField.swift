import SwiftUI
import AppKit

/// Suche: immer sichtbares Feld über der Mailliste, ⌘F setzt den Fokus hinein.
/// Eigenes NSSearchField statt .searchable – das schrumpfte in schmalen Fenstern zur Lupe.
enum MailSearch {
    static let focusNote = Notification.Name("SimpleMailFocusSearch")

    @MainActor
    static func focus(store: MailStore) {
        // Kontakte / Geplant haben keine Mailliste → zur Smart Inbox wechseln
        if store.sidebar == .contacts || store.sidebar == .scheduled {
            store.sidebar = .smart
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                NotificationCenter.default.post(name: focusNote, object: nil)
            }
        } else {
            NotificationCenter.default.post(name: focusNote, object: nil)
        }
    }
}

struct MailSearchBar: View {
    @EnvironmentObject var store: MailStore

    var body: some View {
        HStack(spacing: 8) {
            MailSearchField(store: store)
                .frame(height: 30)
            if !store.searchText.isEmpty && store.searchResults == nil && !store.isSearching {
                Button(store.currentFolderInfo == nil ? "In allen Ordnern" : "Im Ordner") { Task { await store.serverSearch() } }
                    .controlSize(.regular)
                    .help("Auf dem Server in Betreff, Absender und Text suchen (↩)")
            }
            if store.isSearching { ProgressView().controlSize(.small) }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        // Hervorhebung: dezent gelb hinterlegt mit goldenem Rand (wie der Ungelesen-Punkt)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.unreadMarker.opacity(0.16))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.unreadMarkerEdge.opacity(store.searchText.isEmpty ? 0.55 : 0.95),
                        lineWidth: store.searchText.isEmpty ? 1 : 2)
        )
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

struct MailSearchField: NSViewRepresentable {
    @ObservedObject var store: MailStore

    func makeCoordinator() -> Coordinator { Coordinator(store: store) }

    func makeNSView(context: Context) -> NSSearchField {
        let f = NSSearchField()
        f.controlSize = .large
        f.font = NSFont.systemFont(ofSize: 15)
        f.placeholderAttributedString = NSAttributedString(
            string: "Suchen (⌘F) – ↩ durchsucht alle Ordner",
            attributes: [.font: NSFont.systemFont(ofSize: 15),
                         .foregroundColor: NSColor.secondaryLabelColor])
        f.delegate = context.coordinator
        f.sendsSearchStringImmediately = true
        f.stringValue = store.searchText
        f.focusRingType = .default
        context.coordinator.field = f
        return f
    }

    func updateNSView(_ f: NSSearchField, context: Context) {
        context.coordinator.store = store
        // Während der Tipp-Pause nicht zurücksetzen (der Text ist noch nicht im Store)
        if context.coordinator.pending == nil, f.stringValue != store.searchText { f.stringValue = store.searchText }
    }

    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var store: MailStore
        weak var field: NSSearchField?
        /// Lokales Filtern erst nach einer kurzen Tipp-Pause – sonst wird die Liste bei jedem Buchstaben neu aufgebaut
        var pending: DispatchWorkItem?

        init(store: MailStore) {
            self.store = store
            super.init()
            // Selektor-Beobachter meldet sich beim Freigeben selbst ab
            NotificationCenter.default.addObserver(self, selector: #selector(focusSearch(_:)),
                                                   name: MailSearch.focusNote, object: nil)
        }

        @objc func focusSearch(_ note: Notification) {
            guard let f = field, let w = f.window else { return }
            w.makeKeyAndOrderFront(nil)
            w.makeFirstResponder(f)
            f.currentEditor()?.selectAll(nil)
        }

        func controlTextDidChange(_ note: Notification) {
            guard let f = note.object as? NSSearchField else { return }
            let text = f.stringValue
            pending?.cancel()
            // Feld geleert (z. B. ✕): sofort; sonst nach 180 ms Pause
            if text.isEmpty {
                apply(text)
                return
            }
            let work = DispatchWorkItem { [weak self] in self?.apply(text) }
            pending = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: work)
        }

        /// Noch nicht übernommenen Text sofort übernehmen
        private func apply(_ text: String) {
            pending?.cancel()
            pending = nil
            MainActor.assumeIsolated {
                if store.searchText != text { store.searchText = text }
            }
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
            if sel == #selector(NSResponder.insertNewline(_:)) {
                apply((control as? NSSearchField)?.stringValue ?? textView.string)
                let s = store
                Task { @MainActor in await s.serverSearch() }
                return true
            }
            if sel == #selector(NSResponder.cancelOperation(_:)) {
                pending?.cancel()
                pending = nil
                MainActor.assumeIsolated {
                    store.searchText = ""
                }
                (control as? NSSearchField)?.stringValue = ""
                control.window?.makeFirstResponder(nil)
                return true
            }
            return false
        }
    }
}
