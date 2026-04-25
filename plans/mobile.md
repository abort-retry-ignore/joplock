# Mobile PWA Plan

Goal: Make Joplock's mobile PWA feel like Joplin's native mobile app.

## Current State

Joplock mobile has:
- Slide-out nav drawer (folders + notes tree)
- Single 768px breakpoint
- Title editing disabled on mobile
- Horizontal scroll toolbar
- PWA shell with splash screens

## Target State

Match Joplin mobile UX patterns:
- Folder list → note list → editor (3-screen stack navigation)
- Swipe-to-open drawer
- FAB (floating action button) for new note
- Bottom toolbar in editor (stays above keyboard)
- Back button navigation
- Mobile title editing

## Phases

### Phase 1: Screen-based navigation

Replace the tree-view sidebar with a 3-screen mobile flow:

1. **Folders screen**: List of folders with note counts, "All Notes" at top, Trash at bottom. Tap folder → note list.
2. **Note list screen**: Notes in selected folder, title-only rows. Tap note → editor. Back → folders.
3. **Editor screen**: Title + body editing. Back → note list.

Implementation:
- New mobile-specific fragments: `/fragments/mobile/folders`, `/fragments/mobile/notes?folderId=X`, existing editor fragment works
- Mobile layout: single `#mobile-screen` container that swaps content
- Navigation state tracked in JS: `_mobileStack = ['folders']`, push/pop
- Back button (top-left) pops stack, hardware back (popstate) does same
- Use CSS transitions for slide-left/slide-right screen transitions
- Keep desktop layout unchanged — detect via `window.innerWidth <= 768` or `body.mobile-layout` class

### Phase 2: FAB + new note flow

- Floating `+` button, bottom-right, `position:fixed`
- Tap → creates note in current folder, navigates to editor
- If on folders screen, create in General folder

### Phase 3: Swipe gestures

- Swipe right from left edge → open folders drawer (on note list and editor screens)
- Swipe left → close drawer
- Use `touchstart`/`touchmove`/`touchend` with 30px edge threshold
- Animated translateX with requestAnimationFrame

### Phase 4: Editor improvements

- Enable title editing on mobile (remove `applyMobileTitleMode` readonly)
- Bottom toolbar: move toolbar below editor, `position:fixed; bottom:0` or use `visualViewport` API to sit above keyboard
- Toolbar: bold, italic, list, heading, code, link — horizontal scroll
- Preview/edit toggle button in header

### Phase 5: Search

- Search icon in folder/note list header
- Tap → search input slides in, replaces header
- Results shown as flat note list (same as current "Search Results" folder behavior)
- Escape/X clears search, back returns to previous screen

### Phase 6: Polish

- Long-press note → context menu (delete, move to folder)
- Pull-down on note list → refresh
- Empty states: "No notes yet" with create prompt
- Transition animations between screens
- Safe area handling for notch/home indicator
- Tablet breakpoint (768-1024px): show folders + note list side by side

## Constraints

- Mobile layout only activates at `max-width: 768px` — desktop is completely untouched
- All mobile-specific HTML is conditionally rendered or hidden via CSS media queries
- No changes to desktop layout, behavior, or endpoints
- All changes are CSS + client JS + htmx fragments — no architectural changes
- Keep SSR + htmx model, no client-side framework
- Minimize new endpoints — reuse existing fragments where possible

## Files to modify

- `app/templates.js` — mobile layout shell, mobile fragments, mobile JS
- `app/createServer.js` — new mobile fragment endpoints
- `public/styles.css` — mobile screen styles, FAB, transitions
- Possibly split mobile JS into `public/mobile.js` if it gets large
