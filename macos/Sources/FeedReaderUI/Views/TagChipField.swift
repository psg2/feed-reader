import SwiftUI

/// The comma-separated text the detail model stores, and the chips the field shows.
public enum TagText {
    /// Split on commas, trim, lowercase, drop empties and duplicates (first occurrence wins).
    public static func parse(_ text: String) -> [String] {
        var seen = Set<String>()
        return text.split(separator: ",").compactMap { piece in
            let tag = piece.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !tag.isEmpty, seen.insert(tag).inserted else { return nil }
            return tag
        }
    }

    public static func join(_ tags: [String]) -> String { tags.joined(separator: ", ") }

    /// Existing tags that start with what was typed, excluding those already on the post.
    public static func suggestions(for draft: String, among all: [String], excluding chosen: [String], limit: Int = 6) -> [String] {
        let q = draft.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        let taken = Set(chosen)
        return Array(all.filter { $0.hasPrefix(q) && !taken.contains($0) }.prefix(limit))
    }
}

/// Tags as capsules with a × each, plus a text field that commits on Enter or comma.
/// Backspace in the empty field removes the last chip; typing shows matching existing tags.
struct TagChipField: View {
    @Binding var tags: [String]
    var suggestions: [String] = []
    var onCommit: () -> Void = {}

    @State private var draft = ""
    @State private var highlighted: String?
    @FocusState private var focused: Bool

    private var matches: [String] { TagText.suggestions(for: draft, among: suggestions, excluding: tags) }

    var body: some View {
        FlowLayout(spacing: 4) {
            ForEach(tags, id: \.self) { tag in
                TagChip(tag: tag) { remove(tag) }
            }
            TextField(tags.isEmpty ? "Add tags" : "", text: $draft)
                .textFieldStyle(.plain)
                .focused($focused)
                .frame(minWidth: 80)
                .padding(.vertical, 2)
                .onSubmit { commit(highlighted ?? draft) }
                .onChange(of: draft) { _, text in
                    if text.hasSuffix(",") { commit(String(text.dropLast())) } else { highlighted = nil }
                }
                .onKeyPress(.delete) {
                    guard draft.isEmpty, !tags.isEmpty else { return .ignored }
                    tags.removeLast()
                    onCommit()
                    return .handled
                }
                .onKeyPress(.downArrow) { move(1) }
                .onKeyPress(.upArrow) { move(-1) }
                .onKeyPress(.escape) {
                    guard !draft.isEmpty else { return .ignored }
                    draft = ""
                    return .handled
                }
        }
        .padding(.horizontal, 6).padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(focused ? Color.accentColor.opacity(0.6) : Color(nsColor: .separatorColor)))
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .overlay(alignment: .topLeading) {
            if focused, !matches.isEmpty {
                suggestionList.offset(y: -4).alignmentGuide(.top) { d in d[.bottom] }
            }
        }
    }

    private var suggestionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(matches, id: \.self) { tag in
                Text(tag)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(highlighted == tag ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 4))
                    .contentShape(Rectangle())
                    .onTapGesture { commit(tag) }
                    .onHover { if $0 { highlighted = tag } }
            }
        }
        .padding(4)
        .frame(width: 200)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        .font(.callout)
    }

    private func commit(_ text: String) {
        let new = TagText.parse(text).filter { !tags.contains($0) }
        draft = ""
        highlighted = nil
        guard !new.isEmpty else { return }
        tags.append(contentsOf: new)
        onCommit()
    }

    private func remove(_ tag: String) {
        tags.removeAll { $0 == tag }
        onCommit()
    }

    private func move(_ delta: Int) -> KeyPress.Result {
        let m = matches
        guard !m.isEmpty else { return .ignored }
        let i = m.firstIndex { $0 == highlighted } ?? -1
        highlighted = m[max(0, min(m.count - 1, i + delta))]
        return .handled
    }
}

struct TagChip: View {
    let tag: String
    var remove: () -> Void

    var body: some View {
        HStack(spacing: 3) {
            Text(tag).font(.callout)
            Button(action: remove) { Image(systemName: "xmark").font(.system(size: 8, weight: .bold)) }
                .buttonStyle(.plain).foregroundStyle(.secondary).help("Remove tag")
        }
        .padding(.leading, 8).padding(.trailing, 5).padding(.vertical, 2)
        .background(Capsule().fill(Color.accentColor.opacity(0.15)))
    }
}

/// Left-to-right, wrapping rows. Enough for a handful of chips and a text field.
struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(in: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrange(in: bounds.width, subviews: subviews).frames
        for (subview, frame) in zip(subviews, frames) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrange(in width: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for (i, subview) in subviews.enumerated() {
            var size = subview.sizeThatFits(.unspecified)
            // The trailing text field stretches to the end of its row.
            if i == subviews.count - 1 { size.width = max(size.width, width - x) }
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
                if i == subviews.count - 1 { size.width = width }
            }
            frames.append(CGRect(x: x, y: y, width: min(size.width, width), height: size.height))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), frames)
    }
}
