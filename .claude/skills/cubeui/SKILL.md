---
name: cubeui
description: How to use the cubeui components (PageLayout, HeaderContentFooter, StickyHeaderContentFooter, CardLayout, DialogLayout, PageHeader, SplitLayout, SidebarLayout, Sidebar, SidebarSection, SidebarNavItem, Section, DescriptionList, PropertyRow, FormField, FieldRow, useAppForm and its bound fields, ColorPicker, Disclosure, StatTile, SettingRow, CenteredLayout, TopBarLayout on the web; Menu, OptionSelect, SegmentedGroup, SegmentedButton, ThemePicker, useThemePreference, usePalettePreference, PaletteProvider, ConfirmButton, MultiSelect, ActionButton, CopyButton, DatePicker, DateRangePicker, DateTimeInput, SearchInput, PasswordInput, ColorDot, readableTextColor, Command and the icon set on both; Page, DetailPage, Form, FormDialog, ConfirmDialog, QueryState and the React Native primitives in an Expo app) in a project that installs them from the cubeui shadcn registry. Read before building a page shell, a page title block, a card, a sign-in page, a dialog, a two-pane screen, an app's navigation sidebar or top bar, a section heading, a part of a page that shows and hides, a settings row with a switch, select or button at its end, a list of read-only label and value rows, a dashboard's row of figures or the filter tiles over a list, a form, an icon-only button, a popover menu of actions or of on/off rows, or a destructive action with shadcn primitives — it says which component owns the shape and which props carry which node, so hand-written scaffolding is not re-derived per screen.
---

# cubeui

cubeui components are **shells**: they own a shape and take the parts as props. They do not
fetch, they do not hold form state, and they render no text of their own. A shell is one
self-closing element at the call site, and every slot is a named `ReactNode` — a string, an
element, a fragment.

**No cubeui component takes children.** The body is the `content` prop, exactly like the header
and the footer are props, because in a layout every part is dynamic and none of them is the
privileged one. `<CardLayout>{rows}</CardLayout>` is wrong; `<CardLayout content={rows} />` is
right. This is the mistake to check for first when reading or writing a call site.

## Which half you are in

One registry, two URLs. `@cubeui` points at the half that matches the platform the project is,
and the project is one or the other — a DOM app or an Expo app, never both:

```jsonc
// components.json, once per project. A DOM app:
"registries": { "@cubeui": "https://cubicecho.github.io/cubeui/r/{name}.json" }

// An Expo app:
"registries": { "@cubeui": "https://cubicecho.github.io/cubeui/r/native/{name}.json" }
```

```bash
npx shadcn@latest add @cubeui/card-layout   # one item
npx shadcn@latest add @cubeui/layout        # or a set: layout, form-set, control, primitive
```

Install from the registry, do not copy by hand.

**On the web, import the stylesheet once.** Any item whose markup needs `@cubeui/tokens` pulls
it in, landing `cubeui-tokens.css` next to `components.json`, but nothing loads a stylesheet the
app does not import. Put `@import "../cubeui-tokens.css";` in the app's CSS entry, after
`@import "tailwindcss";` and before the app's own palette. Without it a compiled component lays
out as stacked blocks and nothing errors.

**Most items are on both.** `button`, `card`, `input`, `select`, `dialog`, `popover`, `menu`, `command`, `tabs`,
`tooltip`, `badge`, `calendar`, `field`, `item`, `separator`, `skeleton`, `toast`, `empty`, `query-state` — same item name, same props,
one written in React Native and one compiled or hand-written for the DOM. That is the point of
the layout: a call site moves between the two halves unchanged.

**So are the layout shells.** `HeaderContentFooter`, `StickyHeaderContentFooter`, `PageHeader`,
`PageLayout`, `SplitLayout`, `SidebarLayout`, `Sidebar`, `TopBarLayout`, `CardLayout`,
`CenteredLayout`, `DialogLayout`, `Section`, `Disclosure`, `DisclosureRow`, `DescriptionList`, `ListItem`, `StatTile`
and `SettingRow` are written once in
React Native and compiled to the web, so `@cubeui/page-layout` installs in an Expo project and a
Vite one alike, with the same props.

**Some web shells are still web-only.** `FormField`, the `@cubeui/app-form` fields and
the rest of the web-only controls lean on CSS grid tracks and arbitrary
variants, which Yoga and NativeWind do not have. In an Expo project those items are a 404, and
that is the registry telling you the truth rather than shipping a shell that lays out wrong. Use
the native set for those shapes instead — see [Shapes on React Native](#shapes-on-react-native)
at the end.

## Choosing — on the web

| The shape you are building | Use | Reference |
| --- | --- | --- |
| A whole page — a title, buttons, and rows under them | `PageLayout` | [layout.md](layout.md) |
| A page: chrome above, a body that scrolls, chrome below | `StickyHeaderContentFooter` | [layout.md](layout.md) |
| The same three zones, whole thing scrolls with the page | `HeaderContentFooter` | [layout.md](layout.md) |
| The title block at the top of a page: name, buttons, search | `PageHeader` | [layout.md](layout.md) |
| A navigation column or inspector beside a working surface | `SidebarLayout` | [layout.md](layout.md) |
| An app shell: the sidebar on a wide screen, a bar with the brand, icon links and buttons on a narrow one | `SidebarLayout sidebarHideBelow` with `brand`, `nav`, `action` | [layout.md](layout.md#on-a-phone-a-bar-instead-of-the-rail) |
| The app's sidebar itself — brand, titled lists of links, settings and sign out at the bottom | `Sidebar`, `SidebarSection`, `SidebarNavItem` | [layout.md](layout.md) |
| An app shell with no sidebar — a bar across the top with the brand, a few links and the account, the page below | `TopBarLayout` | [layout.md](layout.md#top-bar) |
| Two comparable panes side by side — a diff, a form beside its preview | `SplitLayout` | [layout.md](layout.md) |
| A list beside the detail for the selected row | `SidebarLayout`, or two routes | [layout.md](layout.md) |
| A panel with a title, a body, and buttons at the bottom | `CardLayout` | [layout.md](layout.md) |
| A page that is one card — a sign-in, a token gate — so its title is the page's `<h1>` | `CardLayout level={1}` | [layout.md](layout.md#cards) |
| A page that is one card in the middle of the screen — a sign-in, a token gate, "check your email" | `CenteredLayout` | [layout.md](layout.md#centered-pages) |
| A modal with a title, a body that scrolls, buttons at the bottom | `DialogLayout` | [layout.md](layout.md) |
| A heading over a group of fields or rows | `Section` | [layout.md](layout.md) |
| A settings row — a title and a line on what it does, then a switch, select or button at the far end | `SettingRow` (a lone boolean with its caption: `SwitchField`) | [layout.md](layout.md#setting-rows) |
| Read-only facts — a label, a value, a hint under it, a copy button (a settings or "about" page) | `DescriptionList`, `PropertyRow` | [layout.md](layout.md#description-lists) |
| One figure on a card — a dashboard's row of counts, or the filter tiles over a list that toggle what it shows | `StatTile` | [layout.md](layout.md#stat-tiles) |
| A list page's failed / loading / empty rungs | `QueryState` | [layout.md](layout.md) |
| A list row: an avatar or checkbox, a title over a line, a date and buttons at the far end, optionally pressed to open | `ListItem` | [layout.md](layout.md#listitem) |
| What an empty list says: the centred block for a page, or `compact` — one muted line — inside a card, sidebar or popover | `EmptyState` | [layout.md](layout.md#empty-states) |
| A list row that opens onto detail | `DisclosureRow` | [layout.md](layout.md) |
| A part of a page that shows and hides — "Show completed (3)", a raw payload — instead of `<details>` or a chevron `<button>` | `Disclosure` | [layout.md](layout.md#disclosure) |
| Rows with columns — the same facts on every row, read down as well as across (web only; on native, `ListItem` rows or a `DescriptionList`) | `Table` and its parts | [layout.md](layout.md#table) |
| A form of any size | `useAppForm` and the bound fields | [forms.md](forms.md) |
| A label, a control, a hint under it, and an error | `FormField` | [forms.md](forms.md) |
| Two or three fields that belong on one line | `FieldRow` | [forms.md](forms.md) |
| An icon-only button | `ActionButton` | [controls.md](controls.md) |
| A button that copies a value — an endpoint, a token, a snippet — and ticks when it has | `CopyButton` | [controls.md](controls.md#copy-button) |
| A button that deletes, discards, revokes or resets — with `requireText`, only once its name is typed | `ConfirmButton` | [controls.md](controls.md#type-the-name-to-confirm) |
| A popover of actions or links — a ⋯ menu, Rename / Move / Delete on a row, Open in a router `link` | `Menu`, `MenuItem` | [controls.md](controls.md#menu) |
| A popover of on/off rows that stays open — labels on a todo, columns shown — or a one-of-N filter behind a button | `MenuCheckboxItem`, `MenuRadioGroup`, `MenuRadioItem` | [controls.md](controls.md#menu) |
| A select, a tag picker, a date picker, a colour picker, a password box | the controls | [controls.md](controls.md) |
| A search box over rows that filter as you type — a command palette, a picker's list that is not a tag picker | `Command` and its parts | [controls.md](controls.md#command) |
| A row of pills that switches a view or a period, one current | `SegmentedGroup`, `SegmentedButton` | [controls.md](controls.md#segmented-control) |
| A light / dark / system setting, or a palette such as Monokai, stored and applied | `ThemePicker`, `useThemePreference`, `usePalettePreference`, `PaletteProvider` | [controls.md](controls.md#theme) |
| A date and a time as one `Date` on both halves — or, with `clearable mode="date"`, an optional date only | `DateTimeInput` | [controls.md](controls.md#date-and-date-range) |
| A date, a date with its time in the popover, or a start and an end, behind one full-width trigger, on both halves | `DatePicker`, `DateRangePicker` | [controls.md](controls.md#date-and-date-range) |
| How much of something is done: an upload, a re-embed, a context window filling | `Progress` | [controls.md](controls.md#progress) |
| A colour-coded thing: a swatch, a card's accent stripe, legible text on a chip | `ColorDot`, `Card accentColor`, `readableTextColor` | [controls.md](controls.md#colour) |
| A text field with an icon inside it at the start, or an icon button at the end | `Input leading`, `Input trailing` | [controls.md](controls.md#an-icon-in-an-input) |
| A search or filter box — named, with a ✕ that clears it — alone or in a filter bar | `SearchInput` | [controls.md](controls.md#search) |
| A tag or filter chip with an ✕ that takes it off | `Badge onRemove` | [controls.md](controls.md#removable-badge) |
| An upload of one text file or several, dropped or picked | `FilePicker` | [controls.md](controls.md#file-picker) |
| An Upload button in a page header or toolbar that opens the file dialog directly | `FilePickerButton` | [controls.md](controls.md#as-a-button) |
| A callout on a screen — a key shown once, a fallback in use, the last error — tinted, with an icon | `Alert` | [controls.md](controls.md#alert) |
| A loading indicator — in a button, beside a heading, in place of a value | `Spinner` | [controls.md](controls.md#spinner) |
| A pulsing block standing in for content that has not arrived, inside a part no shell's `loading` covers | `Skeleton` | [controls.md](controls.md#skeleton) |
| A one-pixel rule between groups, across or down | `Separator` | [controls.md](controls.md#separator) |
| An icon anywhere | `@cubeui/icons`, not lucide directly | [controls.md](controls.md#icons) |

If none of them fits, use the shadcn primitives directly — do **not** bend a shell with
`className` until it is a different component. A shape that shows up three times is a case for a
new registry item, not for a fourth variant prop.

## The slot vocabulary

The same words mean the same thing in every component, and this is the point of the set.

**Everywhere:**

- **`content`** — the body. The one slot that grows and the one that scrolls.
- **`title`**, **`description`** — what the thing is called and one line on what it is for.
- **`icon`** — sits before the title. Pass a bare `<Plus />`; the shell sizes and colors it.
- **`action`** — the far end of the *header*. One control, or a fragment of them.
- **`footer`** — the start of the footer. A note, a timestamp, a destructive action held away
  from the others.
- **`footerActions`** — the end of the footer. The buttons, in reading order, primary last.
- **`empty`** — what the body says when `content` comes back empty. Not a slot you place.
- **`loading`** — a boolean. On, the shell substitutes a skeleton for the part of itself that
  the request was going to fill, and `empty` is not consulted.
- **`className`** — the root. Each slot has its own `<slot>ClassName` when it needs one.

**Page, split and dialog shells add:**

- **`breadcrumbs`** — the line above the title. A trail, or a back link, which is a one-step
  trail. Nodes, never a route.
- **`headerContent`** — the row under the title: search, filters, tabs. Stacked in the order
  you pass them.
- **`sidebar`** — the second surface in a `SidebarLayout`. `content` is still the main one, so the
  pair reads the way it does everywhere else.
- **`sidebarPosition`**, **`sidebarWidth`**, **`sidebarHideBelow`**, **`sidebarClassName`** — the
  sidebar's, by prefix. A prop that belongs to a slot wears the slot's name, so it needs no word of
  its own. `sidebarHideBelow="md"` hides the sidebar under `md` and draws the bar in its place.
- **`brand`** — the start of an app's bar: the logo and the app's name, usually a link home. On
  `TopBarLayout`, and on `SidebarLayout`'s bar, which is drawn only where the sidebar is hidden —
  so there pass what the sidebar's header shows.
- **`nav`** — an app bar's navigation, after the brand: the primary links on `TopBarLayout`, the
  places as icon links on `SidebarLayout`'s bar. The shell draws the `<nav>` and `navLabel` names
  it, by prefix — do not wrap it in one yourself. The bar's far end is the core `action`.
- **`cardClassName`** — on `CenteredLayout`, the card; `className` is the page around it. Pass
  `max-w-md` here for a wider card than the default `max-w-sm`.
- **`as`** — not a slot: which landmark a part is, when it can be one. `as="nav"` on a
  `SidebarSection` makes it the navigation landmark, named by its `title` or a `label`. A value,
  never a tag you invent: a part takes only the landmarks its shape can honestly be.
- **`first`**, **`second`** — the two panes of a `SplitLayout`, as equals. Numbered rather than
  named, because a role pair lies about an even split and a side pair lies once the panes stack or
  the page is read right-to-left.
- **`firstWidth`**, **`secondWidth`** — which pane carries the width. One or the other, never both;
  the pane you do not size takes the rest.
- **`width`** — on a page shell, its column: `page`, `prose` or `full`. A named column rather than
  a number, so every page in an app is one of three widths instead of eleven.
- **`level`** — not a slot: `1 | 2 | 3`, which heading element the title is. The size follows the
  element, so you never set both.
- **`trigger`** — what opens a `DialogLayout`, when the dialog owns its own open state. Passing it
  is the alternative to holding `open` yourself, not an addition to it.
- **`open`**, **`onOpenChange`** — anything that opens, and being told when it does. Filed here
  because `DialogLayout` is the first thing that takes it, not the last: `DisclosureRow` takes it,
  and so does `OptionSelect`, whose menu is often filled *by* the opening. Pass `onOpenChange`
  alone to be told without taking over.
- **`defaultOpen`** — where it starts, when the thing holds its own open state: `Disclosure`, and
  the `Dialog`, `Popover` and `Menu` primitives. Pass it instead of `open`, never beside it.
- **`hasUnsavedChanges`** — on `DialogLayout`. On, closing asks first. A boolean, or a function
  called at the click: `() => !form.state.isDefaultValue`. Take the function form when the answer
  is not something the caller renders.
- **`requireText`** — on `ConfirmDialog`, `confirm()` and `ConfirmButton`. The text to type
  before the destructive button unlocks: the folder's name, for a delete that is big and cannot be
  undone. Matched exactly, Enter included. Its label is `requireTextLabel`, by prefix.

**Form components add:**

- **`control`** — the field's body. The only body in the set that is not `content`, because it is
  the only one the shell *wires* rather than places.
- **`label`** — what the control is called. Rendered as a real `<Label htmlFor>`.
- **`error`** — what is wrong with the value, as a string or a node. Falsy draws nothing.
- **`orientation`** — `vertical` (default) or `horizontal`.
- **`required`** — draws the asterisk and sets `aria-required`.
- **`asGroup`** — the label names a *group* of controls rather than one.

**Controls add:**

- **`label`** — on `ActionButton` and `ConfirmButton` it is required, and it is the accessible
  name, not a caption.
- **`hint`** — why the control is unavailable, or what it will do. Read after the name.
- **`leading`** — inside a field, at its start: an icon, the text padded past it. On `Input`.
  Pass a bare `<Search />`; the input sizes and mutes it, and it takes no press.
- **`trailing`** — the far end of a row, after its `label`: a shortcut, a count. On `MenuItem` and the menu's checkbox and radio rows. On `Input`, the far end inside the field: one icon-sized control, such as a clear button.
- **`link`** — the router's link, as an element with no children (`<Link to="/x" />`), which the
  row is drawn inside. On `MenuItem`, so the row is the router's own `<a>` and preloads on hover.
- **`value`**, **`onValueChange`** — every control that holds a value, so one control can be
  swapped for another without rewriting the call site. Never `onChange`, and never a control that
  keeps the value inside itself.
- **`selected`** — beside a press handler, the target is a toggle and this is whether it is on:
  `aria-pressed` on the web, `selected` in the accessibility state on device. On `ToggleChip` and
  `StatTile`. Left out, the target is a plain button; with nothing to press, it is ignored.

**List rows and query states add:**

- **`badges`** — what a row is wearing: a status, a kind, a state. Drawn before the title.
- **`status`** — the state a thing is in, said beside it. On `SidebarSection`, a node between the
  title and the rows (a `<QueryState compact />`). On `SidebarNavItem`, `{ label, icon? }` before
  the count: `label` is read as part of the row's name ("Work, MCP on, 2"), and `icon`, when
  given, is what is seen instead of it — decorative, never read.
- **`leading`** — the start of a row, before the title: an avatar, a checkbox, an icon. Placed as
  given, not sized like `icon`, and never inside the row's pressed area. On `ListItem`.
- **`meta`** — the grey line of facts beside the title: a name, a time, a count. On `ListItem` it
  sits at the row's far end, before `action`.
- **`query`** — a `{ isPending, isError, error, refetch }`, taken structurally so no shell names a
  data library.
- **`what`** — what could not be fetched, in the reader's words: "your agents", "the archive".
- **`count`** — how many rows the page is *about to draw*, which is not what came back.
- **`rows`** — how many placeholder rows stand in for a list while it loads. `<Textarea rows>` is
  the DOM attribute of that name and is not this word.
- **`layout`** — on `DescriptionList`: `inline` (label beside value, stacking by itself when
  narrow) or `stacked`. Its rows reuse `label`, `hint` and `action`, and their `value` is the fact
  on display — a node, not a control's held value.

Rules that follow from the vocabulary:

- Give `footerActions` the buttons, not `footer`. Passing both splits the footer to its ends;
  passing only `footerActions` right-aligns it. Passing only `footer` is a footer of prose.
- Do not wrap a slot in a `<div>` to align or inset it. The shell already did.
- Do not pass a `<CardHeader>` or a `<DialogTitle>` into a slot. Slots take content; the shell
  owns the primitive.
- Adding a word to this vocabulary is a decision about the whole set, not about one component.

## What does not belong in a shell

Data fetching, form state, toasts, routing, permission checks. A shell is handed nodes and
places them. If a screen needs "disable save until valid", that is the caller's, or a form
component's — not a prop on the layout.

The line is *who owns the state*, not *how much the shell does*. `DialogLayout` asks before
closing on unsaved work (`hasUnsavedChanges`) because the state it holds — is the question up? —
is about the dialog's own interaction, not the app's data. Whether the work *is* unsaved is still
asked for, never computed: only the caller knows what its fields are.

A draggable split divider is the same case: the width it drags is state, so it belongs to
`react-resizable-panels`, not to `SplitLayout`. A stored sidebar collapse is the same case again —
`sidebar={open ? <Nav /> : undefined}` is the whole feature, and the caller already holds `open`.

## No inline edits

Every edit is an explicit form: a field that always looks like a field, and a Save that says it
is saving. A value never turns into an input where it sits — no click-to-rename title, no number
on a row that becomes a box on press, no commit on blur. The set used to ship `InlineTextEdit`
and `InlineNumberEdit`; they were removed, and nothing replaces them.

- **A rename or a one-value change** is a `FormDialog` opened from a Rename row, a pencil
  `ActionButton`, or the row itself, with the value in a bound field and Save / Cancel.
- **A settings page** is a form with its fields showing, or a `SettingRow` whose `action` is a
  real control — a `Switch`, an `OptionSelect` — that is always drawn as one.
- **An "Add lane" box** that appears at the end of a list is a field, not an edit: it holds
  nothing until typed into, and Enter adds it.

Do not hand-build the shape either — a `Pressable` text swapped for an `Input` on press is the
same thing without the name.

## Shapes on React Native

The native half is its own set: fewer shells, because a phone screen has fewer shapes in it, and
the ones it has take `children` rather than a `content` prop — a React Native tree is a tree of
views and there is no shell wrapping to hide.

| The shape you are building | Use | Item |
| --- | --- | --- |
| A screen — a title, actions, a body that scrolls | `Page` | `@cubeui/page` |
| The same screen with the web's props, on both halves | `PageLayout` | `@cubeui/page-layout` |
| Chrome above, a body that scrolls, chrome below | `StickyHeaderContentFooter` | `@cubeui/header-content-footer` |
| The title block at the top of a screen | `PageHeader` | `@cubeui/page-header` |
| Two panes side by side, stacked when narrow | `SplitLayout`, `SidebarLayout` | `@cubeui/split-layout` |
| The app's sidebar on a tablet, a bar with the brand and icon links on a phone — see [layout.md](layout.md#on-a-phone-a-bar-instead-of-the-rail) | `SidebarLayout sidebarHideBelow` | `@cubeui/split-layout` |
| An app's navigation sidebar: a header, titled lists of link rows, a footer of link or button rows | `Sidebar`, `SidebarSection`, `SidebarNavItem` | `@cubeui/sidebar` |
| An app with no sidebar: a bar across the top — brand, links, actions — over a screen that scrolls — see [layout.md](layout.md#top-bar) | `TopBarLayout` | `@cubeui/top-bar-layout` |
| A card with a title, actions and a footer | `CardLayout` | `@cubeui/card-layout` |
| A screen that is one card — a sign-in, a token gate — so its title is the heading: `level` 1–3, same size | `CardLayout level={1}` | `@cubeui/card-layout` |
| A sign-in or token screen: one card centred on the screen, scrolling above the keyboard — see [layout.md](layout.md#centered-pages) | `CenteredLayout` | `@cubeui/centered-layout` |
| A dialog with a scrolling body and a discard guard | `DialogLayout` | `@cubeui/dialog-layout` |
| A detail screen for one record | `DetailPage`, `DetailHeader` | `@cubeui/detail-page` |
| A heading over a group of fields or rows, optionally on a card | `Section` | `@cubeui/section` |
| Just the small muted label, with an optional heading `level` | `SectionHeading` | `@cubeui/section-heading` |
| A settings row: a title and a line on what it does, a switch, select or button at the end — see [layout.md](layout.md#setting-rows). A lone boolean with its caption is `SwitchField` | `SettingRow` | `@cubeui/setting-row` |
| A part of a screen that shows and hides — "Show completed (3)", a raw payload — see [layout.md](layout.md#disclosure) | `Disclosure` | `@cubeui/disclosure` |
| Read-only facts: a label, a value, a hint under it, an action beside it — see [layout.md](layout.md#description-lists) | `DescriptionList`, `PropertyRow` | `@cubeui/description-list` |
| One figure on a card, or a pressable filter tile with a pressed state — see [layout.md](layout.md#stat-tiles) | `StatTile` | `@cubeui/stat-tile` |
| A grid of cards, or the empty state under one | `CardGrid`, `EmptyState` | `@cubeui/page` |
| A screen that *is* its empty state — a first run, a record not found, a dead link — so its title is the heading: `level` 1–3, same size | `EmptyState level={1}` | `@cubeui/page` |
| An empty list *inside* something — a card, a sidebar section, a popover: one muted line, optional small icon and action, never a heading — see [layout.md](layout.md#empty-states) | `EmptyState compact` | `@cubeui/page` |
| A form of any size — see [forms.md](forms.md#on-react-native) | `useAppForm`, `Form` and its bound fields | `@cubeui/form` |
| A date or date and time, bound to a form field | `DateTimeField` | `@cubeui/date-time-field` |
| A colour, bound to a form field | `ColorField` | `@cubeui/color-picker-field` |
| A label, a control, a hint under it, and an error | `Field` and its parts | `@cubeui/field` |
| A row of pills that switches a view or a period — see [controls.md](controls.md#segmented-control) | `SegmentedGroup`, `SegmentedButton` | `@cubeui/segmented` |
| Three or four exclusive choices, all on screen (a visibility, a plan) | `RadioGroup`, `RadioGroupItem` | `@cubeui/radio-group` |
| One value from a longer list, in a sheet — options as an array, with groups, rules and notes — see [controls.md](controls.md#option-select) | `OptionSelect` | `@cubeui/option-select` |
| The app's light / dark / system setting and its palette, stored and applied — see [controls.md](controls.md#theme) | `ThemePicker`, `useThemePreference`, `usePalettePreference`, `PaletteProvider` | `@cubeui/theme-picker` |
| The same, bound to a form field | `RadioGroupField` | `@cubeui/radio-group-field` |
| A date and a time as one `Date`, or an optional date only (`clearable mode="date"`) — see [controls.md](controls.md#date-and-date-range) | `DateTimeInput` | `@cubeui/date-time-input` |
| A date, a date and time, or a date range, behind one trigger — see [controls.md](controls.md#date-and-date-range) | `DatePicker`, `DateRangePicker` | `@cubeui/date-picker` |
| How much of something is done — an upload, a context window — see [controls.md](controls.md#progress) | `Progress` | `@cubeui/progress` |
| A colour-coded thing — see [controls.md](controls.md#colour) | `ColorDot`, `Card accentColor`, `readableTextColor` | `@cubeui/color-dot`, `@cubeui/card`, `@cubeui/readable-text-color` |
| A text field with an icon inside it — see [controls.md](controls.md#an-icon-in-an-input) | `Input leading`, `Input trailing` | `@cubeui/input` |
| A tag picker: chips on a trigger, a searchable list in a sheet, each chip removable — see [controls.md](controls.md#multi-select) | `MultiSelect` | `@cubeui/multi-select` |
| A search or filter box — see [controls.md](controls.md#search) | `SearchInput` | `@cubeui/search-input` |
| A search box over rows that filter as you type, each chosen by a press — see [controls.md](controls.md#command) | `Command` and its parts | `@cubeui/command` |
| A tag or filter chip the user can take off — see [controls.md](controls.md#removable-badge) | `Badge onRemove` | `@cubeui/badge` |
| An icon-only button, with a tooltip on a long press and a reason that survives `disabled` — see [controls.md](controls.md#icon-buttons) | `ActionButton` | `@cubeui/action-button` |
| A button that deletes, discards, revokes or resets and asks first — see [controls.md](controls.md#destructive-buttons) | `ConfirmButton` | `@cubeui/confirm-button` |
| A button that copies a value and ticks when it has — see [controls.md](controls.md#copy-button) | `CopyButton` | `@cubeui/copy-button` |
| A callout — a warning, a note, the last error — see [controls.md](controls.md#alert) | `Alert` | `@cubeui/alert` |
| A loading indicator — see [controls.md](controls.md#spinner) | `Spinner` | `@cubeui/spinner` |
| A pulsing placeholder block — see [controls.md](controls.md#skeleton) | `Skeleton` | `@cubeui/skeleton` |
| A one-pixel rule between groups — see [controls.md](controls.md#separator) | `Separator` | `@cubeui/separator` |
| An icon — see [controls.md](controls.md#icons) | the lucide names | `@cubeui/icons` |
| A form in a modal | `FormDialog` | `@cubeui/form-dialog` |
| An action that deletes, discards, revokes or resets — `requireText` to ask for its name first, see [controls.md](controls.md#type-the-name-to-confirm) | `ConfirmDialog` | `@cubeui/confirm-dialog` |
| A popover of actions — a ⋯ menu, Rename / Move / Delete on a row — see [controls.md](controls.md#menu) | `Menu`, `MenuItem` | `@cubeui/menu` |
| A popover of on/off rows that stays open, or a one-of-N filter behind a button — see [controls.md](controls.md#menu) | `MenuCheckboxItem`, `MenuRadioGroup`, `MenuRadioItem` | `@cubeui/menu` |
| A list row: an avatar or checkbox, a title over a line, a date and buttons at the far end, optionally pressable — see [layout.md](layout.md#listitem) | `ListItem` | `@cubeui/list-item` |
| A list row that opens onto detail: badges, a title, a line of facts, a body under it — see [layout.md](layout.md#disclosurerow) | `DisclosureRow` | `@cubeui/disclosure-row` |
| A list screen's failed / loading / empty rungs | `QueryState` | `@cubeui/query-state` |
| A route that threw — render it as the whole error boundary: `role="alert"`, `title`, `details` (the raw message, for a bug report), `actions` (a Reload beside Try again) | `RouteError` | `@cubeui/route-error` |

One name means different things across the halves, and it is worth knowing before you grep:

- **`Form`.** On the web `@cubeui/form-set` is the eight bound-field items and the form component
  is `useAppForm`; on native `@cubeui/form` is one file exporting `Form`, `useAppForm` and its bound
  fields. The item is called `form-set` on the web because `form` is the native component's
  name, and the shadcn CLI resolves a cross-item import by basename — the two cannot share it.

`PageHeader` is one component on both halves: `@cubeui/page-header`. `@cubeui/page` re-exports
it, so `Page` and `PageLayout` draw the same title block — `title`, `description`, `action`,
`icon`, `breadcrumbs`, `loading`, and a `level` (default 1) for the heading's rank.

Everything else in the native set is the primitive of the same name: `Button`, `Card`, `Input`,
`Label`, `Checkbox`, `Switch`, `Textarea`, `Select`, `Dialog`, `Popover`, `Menu`, `Tabs`, `Tooltip`,
`Command`, `Calendar`, `Badge`, `Segmented`, `ToggleChip`, `ColorPicker`, `Toast`, `Code`. They
take the props the web ones take, with four conversions that are the same everywhere:

- **`onPress` on a device, `onClick` on the web.** Every pressable in the native set takes
  `onPress`; its compiled web half renders a real `<button>` and takes `onClick`, with the rest of
  the `<button>` props. So a DOM app writes `onClick` on `Button`, `Card`, `ListItem`, `StatTile`,
  `SidebarNavItem` and the rest, and the examples in these files that say `onPress` read as
  `onClick` there. Code shared between the halves has no one name to write; keep the handler and
  pass it under each half's name.
- **`onChangeText`, not `onChange`.** An RN `TextInput` hands you the string, not an event.
  The compiled web `Input` and `Textarea` take both, so a DOM call site written against shadcn
  still compiles — but shared code should use `onChangeText`, the one that exists on device.
- **`onSubmitEditing` and `onEscape`, not `onKeyDown`.** `Input` answers Enter with
  `onSubmitEditing` and Escape with `onEscape` on both halves, which is all an "Add lane" field
  needs: `onEscape={() => { setDraft(""); setAdding(false); }}`.
  For any other key, `onKeyPress` is React Native's, reading `e.nativeEvent.key`; the web half
  fires it from `keydown`, so it hears Escape and the arrows too. Do not drop to a raw
  `TextInput` for a key. (`Textarea` has none of these yet.)
- **No `asChild` on `Button`.** It exists for handing a button's look to a link, and the routers
  that need it have their own, so the nesting inverts: `<Link asChild><Button /></Link>`.

The web halves go the other way too: `Button`, `Dialog`, `Popover`, `Tooltip`, `Tabs`, `Label`
and `Badge` are a **superset of shadcn's own** there. Every part also takes the props of the radix
part or DOM element it renders, and shadcn's extra parts and sizes exist — `DialogClose`,
`DialogPortal`, `DialogOverlay`, `PopoverAnchor`, `PopoverClose`, `PopoverHeader`, controlled `Tabs`,
`TooltipContent sideOffset`, `Badge asChild`, `size="icon-sm"`. So a shadcn call site compiles
unchanged. The new parts and sizes exist on native too; the radix and DOM passthrough props are
web only, and a native call site keeps to the shared contract.

`file-picker` is the one item whose native half does not do the job: it draws the zone and says
so on screen, and `FilePickerButton` draws a disabled button that says so as its hint, because picking a file needs `expo-document-picker` and a permission flow that is
the app's choice. The contract is there, including `multiple` and `onPickMany`. The picking is
not.
