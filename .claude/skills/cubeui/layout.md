# cubeui layout

Read [SKILL.md](SKILL.md) first — the slot vocabulary and the "no children" rule are there and
are not repeated here.

**Both halves, one source.** Pages, page shells, page headers, splits, cards, dialogs,
sections, disclosures, sidebars and the top bar are written once in React Native and compiled to
the web, so the same item installs in a Vite app and an Expo app with the same props. The
list-page parts at the end are the exception: `Table` is web-only, and `QueryState` is its own
item on each half; `DisclosureRow` and `ListItem` are on both, like the shells. On a device,
four things differ, and none of them changes a call site:

- `HeaderContentFooter`'s body is a `ScrollView` when it scrolls, so `contentRef` is the
  `ScrollView` there (a `<div>` on the web), and `contentClassName` styles its content container.
- An `icon` is not sized for you on a device — there is no `[&_svg]` selector — so pass it at
  `size-4` yourself (`size-5` in a level 1 or 2 `PageHeader`).
- A split's two panes are a flex row, not grid tracks. The widths and `stackBelow` read the same.
- A string or number passed to a slot is wrapped in a `Text` for you, so a bare `"Save"` does not
  crash a `View`. A node you build yourself still needs its own `Text`.

## Pages

`PageLayout` is a page: a title block pinned above a body that scrolls under it. It is
`StickyHeaderContentFooter` with a `PageHeader` already in the header slot, and it is what a
route should reach for first.

```tsx
<PageLayout
  title="Workspaces"
  description="Each one exposes the servers you choose."
  action={<Button size="sm"><Plus /> New workspace</Button>}
  headerContent={<Input aria-label="Search workspaces" placeholder="Search workspaces" />}
  width="page"
  content={<WorkspaceList />}
/>
```

**Do not write the column yourself.** No `mx-auto max-w-3xl`, no `min-h-0 flex-1 overflow-y-auto`,
no `<header className="border-b px-6 py-4">`. `width` is the whole vocabulary:

- `page` — a list, a board, a table. The default.
- `prose` — settings, a detail page, a form. A reading column.
- `full` — a pane already inside someone else's column.

Three names because there were 51 capped page columns across these projects wearing 10 different
widths, and two apps that had each extracted a `Page` component still disagreed on what their
`wide` boolean meant. If none of the three is right, the page wants `HeaderContentFooter`
directly — not a fourth name.

`headerContent` is the row under the title: search, filters, tabs. Passing it removes the rule
under the header, which is correct — the search row is already the separator.

`loading` waits the **title**, not the body. The buttons and the search field stay usable. The
body's own loading state is the caller's, or `CardLayout`'s.

`PageLayout` does not own the sidebar, the theme toggle, or the route. That is an app shell: put
a [`Sidebar`](#sidebar) and the page side by side in a `SidebarLayout`.

## Page shells

Reach for these when a page is not the shape `PageLayout` makes — a pane, a print sheet, a
dialog body.

```tsx
<StickyHeaderContentFooter
  width="page"
  header={<PageHeader title="Vendors" description="Suppliers inventory is purchased from." />}
  content={<DataTable columns={columns} data={rows} />}
  footer={<Pagination page={page} onPageChange={setPage} />}
/>
```

- `width="page"` caps and centres every slot on one column, so the title sits above the first
  table column rather than beside it. `width="full"` (the default) fills the box it was given —
  panes inside a split, print sheets, anything already in a column of its own.
- The sticky variant needs a **height to divide**. It defaults to `h-full`; the ancestors up to
  the viewport need to give it one, or nothing scrolls and the header does not stay.
- `HeaderContentFooter` is the same three zones with the whole thing scrolling with the page.
- Scroll position lives on the body, not the window: use `contentRef` to read or restore it.

## Page headers

`PageHeader` is the title block on its own, for when it goes in another shell's `header` slot.
It is not a page.

```tsx
<PageHeader
  title="Workspaces"
  description="Each one exposes the servers you choose."
  action={
    <>
      <Button size="sm" variant="outline"><Download /> Export</Button>
      <Button size="sm"><Plus /> New workspace</Button>
    </>
  }
  content={<SearchInput value={query} onChange={setQuery} />}
/>
```

- **The header brings its own inset, and the shell around it knows.** `HeaderContentFooter` leaves its
  `header` slot unpadded on purpose and gives the body `px-4` to match, so the title lands above
  the body's first column. Do not pad the header slot, and do not wrap a `PageHeader` in a `div`
  to inset it — that seam is already joined, in one file.

  Dropped into something that already pads its children (a `<main className="p-6">`), pass
  `className="px-0"` so exactly one of the two owns the inset. That is the only case that needs a
  word from you.

- **`content` here is the row under the title** — a search field, a filter row, tabs; stacked, in
  the order you pass them. (`PageLayout` calls the same slot `headerContent`, because its own
  `content` is the page body.) There is no `search` prop, no `filters` prop and no `tabs` prop.

- **`action` is the far end, and it is one slot for all of them.** Pass a fragment of buttons; a
  status pill goes here too. The shell rows and gaps them, so two pages never disagree about the
  space between Export and New.

- **`breadcrumbs` is the line above the title.** Put a back link here rather than beside the
  title: beside it, it competes with `icon` for the same spot and takes width from the page's name.

- **`level` picks the heading**, `1` by default. A header inside a card, a pane of a split, or
  anything already under a page title passes `level={2}`. Do not pass `title={<h1>Workspaces</h1>}`
  and do not restyle the title — the level carries the size, which is the whole point of it.

- **`loading` stands in for the title**, at the title's exact height, so the page below does not
  jump when the name lands. Everything that did not come from that request — the trail, the
  buttons, the search field — stays put and stays usable.

  ```tsx
  <PageHeader breadcrumbs={<Link to="/workspaces">Workspaces</Link>} loading={isPending}
    title={workspace?.name} action={<EditButton />} />
  ```

- **The rule under the header is not a prop.** It is drawn when there is no `content` and not
  drawn when there is, because a search row already separates the header from the body and a
  second divider under it is one too many. A screen that disagrees says so in one class:
  `className="border-b-0"`.

- **A long title wraps; it never truncates**, and the buttons drop to their own line before the
  title is squeezed. That is driven by the header's real width against the action's real width,
  not by a viewport breakpoint, so it also holds for a narrow pane on a wide screen.

### What it does not have

`search`, `filters`, `tabs` — pass them as `content`. A count or status badge — put it in
`action`, or compose it into the `title` node. A back button *beside* the title — it goes in
`breadcrumbs`. A description that expands behind a popover — that is state, and state is the
caller's.

## Splits

```tsx
<SidebarLayout
  sidebarPosition="start"
  sidebarWidth="sm"
  stackBelow="md"
  divider="line"
  sidebar={<Nav />}
  content={<StickyHeaderContentFooter header={<PageHeader title="Servers" />} content={rows} />}
/>
```

`content` is the main surface and `sidebar` is the second one. Everything else is where the sidebar
sits, how wide it is, when it stops sitting there, and what is between them.

**`SidebarLayout` is a preset of `SplitLayout`**, which is the same shape with the roles taken out:

```tsx
<SplitLayout
  first={<Original />}
  second={<Translation />}
  stackBelow="md"
  firstWidth="two-thirds"
/>
```

Reach for the base when the two panes are genuinely comparable — a diff, two lists abreast, a form
beside its preview. Its slots are numbered because neither alternative stays true: `content` /
`sidebar` claims a ranking an even split does not have, and `left` / `right` is wrong below
`stackBelow`, where the panes are one above the other, and wrong again right-to-left. `first` is
first in reading order, wherever reading is going.

Either pane can carry the width — `firstWidth` **or** `secondWidth`, the same scale, never both.
Neither set is an even split. Everything below applies to both, and every prop but the widths and
the slots is spelled the same on each.

- **`sidebarWidth` is a scale, not a number.** `auto` (an icon strip, as wide as its contents),
  `sm` / `md` / `lg` (an inspector, sized by what is in it), and `fifth` / `two-fifths` / `half`
  / `two-thirds` (a second working surface, sized by the window). Pick the nearest one. A width
  that falls between two of them is a call site choosing, not a case for a ninth step — the
  scale exists because the widths it replaced were spelled `w-56`, `w-72 lg:w-80`, `lg:w-52`,
  `w-14 lg:w-56`, `2fr`, `minmax(16rem,20rem)` and `60%`, with no way to read which of those
  differences were decisions.
- **`stackBelow` is the width under which the two stop sitting side by side and stack instead**
  — `md`, `lg` (the default), `xl`, or `never` to keep them side by side at every width. Stacking is the narrow-width answer: a phone
  has room for one pane after the other even when it has none for two abreast. Do not add
  `hidden md:block` to fight it; a navigation rail that should go rather than stack is
  `sidebarHideBelow` (see [Sidebar](#on-a-phone-a-bar-instead-of-the-rail)).
- **`divider`** is `space` (a gap — two surfaces on a page, the default), `line` (flush, with a
  hairline between them — the app shell), or `none` (flush, nothing drawn). Do not draw the rule
  yourself with a `border-r` on the sidebar: that is a line between the panes only until the layout
  stacks, at which point it is a line down one side of the screen. `line` draws the rule as its
  own element between the panes, so it turns with them.

### The things it deliberately does not do

- **It does not resize.** There is no draggable divider and no `onWidthChange`, because a stored
  width is state and shells hold none. The divider is a rule, not a control: `aria-hidden`, no
  role, no tab stop. A screen that genuinely needs a drag wants shadcn's `resizable`
  (`react-resizable-panels`) — a different component, not a prop on this one.
- **It does not collapse, because it does not have to.** A closed sidebar is
  `sidebar={open ? <Nav /> : undefined}`. With no sidebar it is one full-width column, no cell
  and no rule drawn and no gap spent — which is the same thing an inspector with nothing selected
  needs. The caller already holds the toggle; there is no `collapsed` prop to keep in step with it.
- **It has no `loading`.** A split has two panes that arrive at different times, and one boolean
  across both would either skeleton a navigation column that was never waiting or have to be told which
  pane it meant. Each pane's content owns its own loading state.
- **It is horizontal only.** Two zones stacked in a column, each able to scroll, is
  `HeaderContentFooter`, which already exists. Below `stackBelow` this *is* that arrangement.
- **It does not scroll.** A pane that needs to scroll is a `StickyHeaderContentFooter` passed as
  `content` or `sidebar` — which is also where the tab stop that a scrolling region owes a keyboard
  user comes from. Do not put `overflow-y-auto` on a pane by hand; without a height above it to
  divide, it will not scroll, and it gives a keyboard user no way in.

### List-and-detail

A split is the right shape when both panes are on the screen together and the selection moves
between them. It is the wrong shape when the detail is a place you *go* — if there is a
`/things/:id` route, keep the route and let the detail be its own page. A `SidebarLayout` that has to
be told to hide a *detail* pane on a phone is that decision arriving late — `sidebarHideBelow` is
for the app's navigation rail, which has a bar to stand in for it.

## Sidebar

```tsx
<SidebarLayout
  sidebarWidth="auto"
  stackBelow="never"
  divider="none"
  sidebar={
    <Sidebar
      label="Main"
      header={<Brand />}
      content={
        <SidebarSection
          as="nav"
          title="Projects"
          action={<Button variant="ghost" size="xs" aria-label="New project"><Plus /></Button>}
          status={
            <QueryState
              compact
              query={projects}
              what="projects"
              count={rows.length}
              empty={<EmptyState compact title="No projects yet." className="px-2" />}
            />
          }
          content={rows.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} asChild>
              <SidebarNavItem
                label={p.name}
                icon={<Folder />}
                count={p.open}
                status={p.shared ? { label: "Shared", icon: <Users /> } : undefined}
                active={p.id === current}
              />
            </Link>
          ))}
        />
      }
      footer={
        <>
          <SidebarNavItem href="/settings" label="Settings" icon={<Settings />} />
          <SidebarNavItem label="Sign out" icon={<LogOut />} onPress={signOut} />
        </>
      }
    />
  }
  content={page}
/>
```

`@cubeui/sidebar` is the navigation column itself, where `SidebarLayout` is only where it sits.
Three parts, and only `Sidebar` is required:

- **`Sidebar`** — the frame: `header`, a `content` that scrolls, `footer`, on `bg-sidebar` at a
  fixed `w-64` with a `border-sidebar-border` rule on the edge facing the page (`side="end"` moves
  it). It is a `StickyHeaderContentFooter` inside, so it needs a height from above, like any
  sticky chassis. `label` names it — an `<aside>` on the web, a complementary landmark. Put it in a
  `SidebarLayout` with `sidebarWidth="auto"`, and `divider="none"` because it draws its own rule; a
  different width is one `w-*` in `className`. `sidebarHideBelow` on the layout removes it
  under a width and draws a bar in its place (see below).
- **`SidebarSection`** — an overline `title` over a real list: `role="list"` and one
  `role="listitem"` per row, named by the title. Pass the rows as an **array** (`rows.map(…)`,
  keyed); each element becomes one item, so a fragment or a wrapper around them is one item
  holding everything. `status` sits between the title and the list and is where a
  `<QueryState compact …/>` goes; no list is drawn while there are no rows. `level` is the
  title's heading rank, 2 by default. **`as="nav"` makes the section a navigation landmark** — a
  `<nav>` on the web, `role="navigation"` on device — named by its `title`, or by `label` when it
  has none or two would share one. `Sidebar` is a complementary `<aside>`, so without it the rows
  are in no navigation landmark at all; do not wrap the section in a hand-written
  `<nav aria-label>`. Leave it off the sections that are not navigation — recent items, pinned
  searches — so the landmark holds only the app's own places. `label` without `as="nav"` is a
  type error.
- **`SidebarNavItem`** — the row: `href` (left off when a router link supplies it), `label` (one
  line, truncated), `icon?`, `count?`, `status?`, `active`. It is `role="link"` — an `<a href>` on
  the web — and `active` fills it with `selection` and sets `aria-current="page"`. Hover fills it
  from `sidebar-accent`, so the current page never looks like the row under the pointer. **`status={{ label, icon? }}` marks the row's state** — "MCP on", "offline",
  "draft" — before the count, and the row is named "Work, MCP on, 2": clipped text inside the row
  on the web, part of its `accessibilityLabel` on device. With an `icon` the icon is what is seen
  and is decorative; without one the label is drawn, small and muted. Do not put a status in the
  leading `icon` or hand-write the row's `aria-label` to say it — a caller's `aria-label` replaces
  the whole name the row builds. **With `onPress` and no `href` it is a button** — `onClick` on the web, and no
  `active`: `role="button"`, a `<button type="button">` on the web, never `aria-current`, drawn
  exactly like the links beside it. That is the footer's Sign out; do not hand-draw it with a
  `Pressable` and copied classes. The props are a union, so `active` on a button is a type error.

**Routing is the app's.** The row names no router. Wrap it in your router's link and **leave
`href` off the row** — the router supplies it, so the destination is written once:

```tsx
<Link href="/settings" asChild>                 {/* expo-router */}
  <SidebarNavItem label="Settings" active={isSettings} />
</Link>

const SidebarLink = createLink(SidebarNavItem); // TanStack Router
<SidebarLink to="/settings" label="Settings" active={isSettings} />
```

Both render the row with the `href` they built and their own press handler, so it is still a
real `<a href>` that middle-click and "copy link" read; the row forwards its ref and every prop it
does not name. Passing `href` beside `to` is the same place written twice, and the two drift. A
router that hands out only a click handler — react-router's `useLinkClickHandler` — passes it as
`onClick` beside the row's own `href`. With no router at all, the `<a href>` still navigates.
`active` is yours to compute from the current route. A row with no `href`, no `onPress` and no
router around it goes nowhere and does nothing — it is drawn as an inert button.

Do not pass an icon a size or a colour: the row sizes it to `size-4` and colours it with the label.
A row in the footer takes no `SidebarSection` — a list item with no list around it is invalid.

### On a phone, a bar instead of the rail

A rail does not stack; under a narrow width it goes, and a bar over the page stands in for it.
That is `SidebarLayout`'s `sidebarHideBelow`, and the bar is three slots:

```tsx
<SidebarLayout
  className="h-svh"
  sidebarPosition="start"
  sidebarWidth="auto"
  divider="none"
  sidebarHideBelow="md"
  sidebar={<Sidebar label="Main" header={<Brand />} content={nav} footer={<Settings />} />}
  brand={<Brand />}
  nav={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
    <Link key={to} to={to} aria-label={label} className="rounded-md p-2 …">
      <Icon className="size-4" />
    </Link>
  ))}
  navLabel="Main"
  action={<><LockButton /><ThemeToggle /></>}
  content={<main className="min-h-0 flex-1 overflow-auto">{page}</main>}
/>
```

- **Under `md`** the sidebar pane is `display: none` — off the screen and out of the accessibility
  tree — and the bar is drawn over `content`: a `<header>` (the banner) with `brand` at the start,
  `nav` inside a `<nav>` named by `navLabel`, and `action` at the far end. **From `md` up** it is
  the other way round. `sm`, `lg` and `xl` move the switch.
- **One breakpoint, said once.** Leave `Sidebar`'s own `hideBelow` off; the layout hides the rail
  and shows the bar from the same value, so the two cannot disagree. Do not hand-write the
  `md:hidden` header in `content` — that is the copy this replaces, and its `<nav>` was the one
  that went unnamed.
- **`nav` requires `navLabel`**, and the bar's slots require `sidebarHideBelow` — both type errors
  otherwise. `stackBelow` is not taken with it (a rail that hides does not stack) and neither is
  `divider="line"` (with the rail gone the rule would be a line down the edge of the screen);
  `divider="none"` is right for a `Sidebar`, which draws its own border.
- **The bar holds what the rail's header and footer hold** — the brand, the places, the theme and
  sign-out buttons — because on a narrow screen it is the only place they are. Anything that
  should show at every width belongs in the page, not the bar.
- **No state.** Which of the two is drawn is a media query in the stylesheet, so the first paint is
  right and nothing opens or closes. A drawer that slides the rail over the page is a different
  component; this is not it.
- **On device** NativeWind reads the same breakpoint off the window: a phone draws the bar and a
  tablet the rail, which is what `Sidebar`'s `hideBelow` already does there.
- `headerClassName` is on the bar. With no `brand`, `nav` or `action`, `sidebarHideBelow` still
  hides the rail and draws nothing in its place.

`Sidebar`'s `hideBelow` (`sm` / `md` / `lg` / `xl`) is the same switch for a sidebar that is not
in a `SidebarLayout`. Do not write `hidden md:flex` in `className` for either: that works only
while the root's own display class happens to merge first.

## Top bar

```tsx
<TopBarLayout
  brand={<Link href="/"><ClockMark /><Text>eunomia</Text></Link>}
  nav={views.map((v) => (
    <Link key={v.href} href={v.href} aria-current={v.href === path ? "page" : undefined}>
      {v.label}
    </Link>
  ))}
  action={<Button variant="ghost" size="sm" onPress={signOut}>Sign out</Button>}
  content={<Outlet />}
/>
```

`@cubeui/top-bar-layout` is the app shell for an app with a handful of top-level pages and **no
sidebar**: a bar across the top, the page below it. Three slots in the bar, one under it:

- **`brand`** — the bar's start: the logo and the app's name, usually a link home. It keeps its
  width.
- **`nav`** — the primary links, after the brand. Pass the links themselves; the shell draws the
  navigation landmark around them (`<nav>` on the web, `role="navigation"` on device), so do not
  hand-write a `<nav>` inside it. `navLabel` names the landmark — "Main" — when the page has a
  second one to tell it from. Marking the current page (`aria-current`, an active fill) is the
  link's, since only the router knows the route.
- **`action`** — the bar's far end: account, theme, sign out. The same word as every header's far
  end. It keeps its width and sits at the end whether or not there is a `nav`.
- **`content`** — the page. It is wrapped in the `main` landmark (`<main>` on the web), and the bar
  is the `banner` landmark (`<header>`), so a screen reader's landmark jump reaches the page past
  the chrome. Pass a `PageLayout` here — it carries its own title and column.

**On the web the bar is `sticky top-0` and the document scrolls.** It needs no height from its
ancestors, unlike a `StickyHeaderContentFooter`: the bar sticks to the top of whatever scrolls it —
the window, or a pane you already made scrollable. **On device** there is no sticky, so the shell
divides the height it is given: the bar stays and the page is a `ScrollView`, as in
`StickyHeaderContentFooter`. Give it the screen (`flex-1` on the parent).

**On a narrow screen the links scroll sideways** inside their landmark while the brand and the
actions keep their place, so six links on a phone move rather than wrap the bar to two lines. To
hide them instead below a width and offer a menu, it is one class and a `Menu` in `action`:
`navClassName="hidden md:flex"` beside `action={<><Menu …className="md:hidden" /><Account /></>}`.

`width` holds the bar's row to a column — `page` (default), `prose` or `full` for a board that
runs to the window's edge — so the brand lines up with the page under it. The border and fill are
always full-bleed. `headerClassName` is on the bar itself (its fill, its border), `contentClassName`
on the `<main>`.

**The top safe area on device is the app's.** The bar is the top of the screen, and the status bar
covers it unless something insets it; wrap the app in `react-native-safe-area-context`'s
`<SafeAreaView edges={["top"]}>` (Expo ships it). The shell adds no dependency to measure insets.

**Beside `SidebarLayout`.** They are the two app shells: navigation across the top here, down the
side with `Sidebar` in a `SidebarLayout`. Pick by how many places the app has — a handful fit a
bar, a list of projects needs a column. An app with both is a `SidebarLayout`, and the phone-width
bar in its `content` (the `md:hidden` header above) is still hand-written; `TopBarLayout` is not a
second wrapper around a sidebar.

## Cards

```tsx
<CardLayout
  title="Categories"
  description="Deleting a category keeps its activities — they go back to uncategorized."
  action={<Button size="sm">Add</Button>}
  loading={isPending}
  content={categories.map((category) => (
    <CategoryRow key={category.id} category={category} />
  ))}
  empty={<EmptyState compact title="No categories yet." />}
  footerActions={<Button onClick={save}>Save</Button>}
/>
```

`empty` replaces the body when `content` is empty — which is what `items.map(…)` returns for
empty data, so write the `map` plainly and let the shell handle the nothing case. Do not write
`{items.length === 0 ? <Empty /> : items.map(…)}`.

What goes in `empty` inside a card is one muted line, `<EmptyState compact … />` — see
[Empty states](#empty-states) — not a hand-written `<p className="text-sm text-muted-foreground">`.

`loading` replaces it with a skeleton and outranks `empty`, so a card that is still fetching does
not first announce that it is empty. Pass the query's pending flag straight in; do not write
`{isPending ? <Skeleton /> : …}`. A caller that wants its own placeholder passes that as
`content` and leaves `loading` off.

`level` is which heading the title is, `1 | 2 | 3`, and it defaults to 3 — right for a card on a
page that already has a title. When the card **is** the page — a sign-in, a token gate, a lone
settings panel with nothing above it — pass `level={1}`, so the page's only heading is its `<h1>`.
The title is the same size at every level; the rank says where the card sits, not how it looks.
`CardTitle` takes the same `level` if you are composing `Card` by hand.

The `footerActions` row **wraps when the card is narrow**: three buttons in a phone-width card
put the last one on a second line, still against the right edge, rather than running the first
out past the card's left edge. `CenteredLayout` and `DialogLayout` draw the same row. Do not
reach into it with `footerClassName="[&>div]:flex-wrap …"`, and do not wrap the buttons in a
`<div>` of your own to get it.

## Centered pages

The sign-in page, the token gate, the "check your email" screen: one card in the middle of a page
of its own. `CenteredLayout` is that page — full height, centred both ways, `p-4` off the edges —
around a `max-w-sm` `CardLayout`, and it takes every slot the card takes, under the same names.

```tsx
<CenteredLayout
  icon={<KeyRound />}
  title="Authentication required"
  description="Enter the router token from settings.json."
  content={
    <form id="token" onSubmit={submit}>
      <FormField label="Token" control={<Input type="password" value={token} onChangeText={setToken} />} />
    </form>
  }
  footerActions={
    <Button type="submit" form="token" disabled={!token.trim()}>
      Unlock
    </Button>
  }
/>
```

Render it *instead of* the app shell, not inside it: on the web its root is the page's `<main>`,
and `min-h-svh` tall. `className` is that page — a `bg-background`, a different padding.
`cardClassName` is the card: `cardClassName="max-w-md"` for a wider one, which replaces the cap.

On device the root is a `ScrollView` filling the screen, so a form in the card stays reachable
when the keyboard comes up, and a tap on the submit button is not spent dismissing the keyboard.
Do not wrap it in a `KeyboardAvoidingView` or a `ScrollView` of your own.

A sign-in with no card — a heading and a form on the bare background — is not this shape; lay
that out with `Page` or by hand rather than stripping the card with `cardClassName`.

## Dialogs

```tsx
<DialogLayout
  trigger={<Button>New workspace</Button>}
  title="New workspace"
  description="A workspace exposes the servers you choose at its own URL."
  size="lg"
  content={<WorkspaceFields value={draft} onChange={setDraft} />}
  footerActions={(close) => (
    <>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
    </>
  )}
/>
```

- `title` is **required** — it is what assistive technology announces. A design with no room for
  a heading passes `hideTitle`, which keeps the title and takes it off the screen. Never drop it.
- Give a `trigger` and no `open`, and the dialog owns its state. Pass `open`/`onOpenChange` when
  something outside the trigger opens it (a row menu, a route, a keyboard shortcut).
- The body scrolls; the header and footer do not. Do not add `max-h-*` or `overflow-y-auto` — a
  cap on the whole dialog is what takes the title off the screen on a long form.
- **`hasUnsavedChanges` is the one to remember.** On, Escape, a click on the overlay and the
  close button all ask before throwing the work away, and the dialog is still there behind the
  question. It is asked for, never computed, because only the caller knows what its fields are.
  `discardTitle`, `discardDescription`, `discardLabel` and `keepLabel` reword the question when
  the dialog knows what is lost.
- **Pass it as a function when the answer is not something you render.** The question is asked
  once, at a click — nothing in the dialog draws the answer — so a boolean makes you keep a value
  in render that only a handler reads, and work held outside the form's fields has to be lifted
  into state to answer at all. `hasUnsavedChanges={() => !form.state.isDefaultValue ||
  picker.hasEdits()}` runs at the click and subscribes to nothing. `isDefaultValue` and not
  `isDirty`: `isDirty` stays true for a field typed into and then back out of, so the dialog asks
  about a form identical to how it opened.
- **Take `close` from `footerActions` rather than closing the dialog yourself.** Pass a function
  and it is handed the dialog's own close — the same one Escape, the overlay and the close button
  go through, so `hasUnsavedChanges` asks on the way through Cancel too. A Cancel wired to your
  own `setOpen(false)` goes around the shell, and that is the door people actually click:

  ```tsx
  footerActions={(close) => (
    <>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button onClick={save}>Save</Button>
    </>
  )}
  ```

  The node form still works and is right for a footer that closes nothing. Only `footerActions`
  takes the function; `footer` is the other end of the row.
- `dismissible={false}` refuses Escape and outside clicks outright. Prefer `hasUnsavedChanges`,
  which asks on the way out rather than refusing to leave.
- A form in a dialog is this component with a `<form>` as `content` — see [forms.md](forms.md).

## Sections

A heading over a group of fields or rows, inside a page or a card.

```tsx
<Section
  title="Danger zone"
  description="These cannot be undone."
  content={<ConfirmButton label="Delete project" … />}
/>
```

- One source for both platforms: the same item is `@cubeui/section` in `/r/web` and `/r/native`.
- The title is a heading of rank `level`, **2 by default**: `PageHeader` owns the `h1`, so a
  section on a page is the one below it. Nested in another section, or in a dialog whose title is
  the `h2`, pass `level={3}`. Choose it by where the section sits, never by how big the text should
  look — the text is the same size at every level. On the web it is `role="heading"` +
  `aria-level` rather than an `<hN>` element (same heading to a screen reader; style it by
  `data-slot="section-title"`, not by `h2`).
- The root is a `<section>` on the web, named by its title, so a titled section is a `region`
  landmark. There is nothing to add for that — do not wrap it in another `role="region"`.
- It draws **no surface** by default. `surface="card"` puts the whole group on a card (border,
  background, padding) — use that instead of wrapping it in a `Card` yourself. `CardLayout` is still
  the component for a card with a header and footer of its own.
- `divider` adds a hairline under the heading. Off by default.
- It is the smallest thing in the registry and it exists because three projects wrote
  `text-xs font-semibold uppercase` plus a muted foreground from memory, and each got the sixth
  token different (`tracking-wider`, `tracking-wide`, `border-b pb-1`). A shared token has no
  answer for that, because the value being retyped *is* a class list.

## Disclosure

A part of a page whose body shows and hides — "Show completed (3)" under a list, "Raw output"
over a payload nobody reads in passing. Use it instead of a `<details>`, which has no React Native
counterpart, and instead of a chevron `<button>` or a ghost `Button` with a `useState` beside it.

```tsx
<Disclosure
  title="Raw output"
  action={<Button size="sm" variant="ghost" onPress={copy}>Copy</Button>}
  content={<Code>{json}</Code>}
/>

<Disclosure
  title={`${showCompleted ? "Hide" : "Show"} completed (${completed.length})`}
  open={showCompleted}
  onOpenChange={setShowCompleted}
  content={completed.map((todo) => <TodoRow key={todo.id} todo={todo} />)}
/>
```

- One source for both platforms: `@cubeui/disclosure` in `/r` and `/r/native`.
- The **whole header is one button** with a chevron that turns, so it is reached by Tab and
  toggled by Enter and Space. `aria-expanded` is on it, and on the web `aria-controls` names the
  body while the body is there.
- **`action` sits beside the button, not inside it**, so pressing it does not toggle the section.
  Do not put a control in `title`.
- `content` is **not mounted while shut** — a long list behind it costs nothing, and anything that
  must survive closing (a draft, a scroll position) belongs to the caller.
- Uncontrolled by default, shut: pass `defaultOpen` to start open. Pass `open` and `onOpenChange`
  when the caller needs the state — a title that says Hide once open, a deep link, a "show the
  failure" button elsewhere on the page. `onOpenChange` alone listens without taking over.
- The look is compact: a muted `text-sm` title after the chevron, `description` a smaller line
  under it, the body underneath with no inset. `titleClassName="text-foreground"` when the
  disclosure is the heading of its part of the page; `contentClassName` to indent the body.
- A row in a list that opens onto its detail is `DisclosureRow`, which adds the row's `badges`,
  `meta` and surface.

## Description lists

Read-only facts — a label, a value, a line under the value — which is most of a settings page or an
"about this server" page.

```tsx
<Section
  title="Index"
  content={
    <DescriptionList
      content={[
        <PropertyRow key="e" label="Embedder" value="bge-small" hint="Set with RAGDOWN_EMBEDDER" />,
        <PropertyRow
          key="d"
          label="Docs folder"
          value={<Code>/data/notes</Code>}
          action={<CopyButton value="/data/notes" label="Copy docs folder" />}
        />,
        <PropertyRow key="i" label="Index" value="1,204 chunks" hint="Synced 2 minutes ago" />,
      ]}
    />
  }
/>
```

- One source for both platforms: `@cubeui/description-list` in `/r/web` and `/r/native`, exporting
  `DescriptionList` and `PropertyRow`.
- `DescriptionList` takes the rows as `content` — `PropertyRow`s and nothing else, as an array
  with keys or a fragment. Do not wrap a row in a `<div>`: on the web the list is a `<dl>`, which may
  hold only its term-and-description groups.
- `PropertyRow` is `label` (what the fact is called), `value` (the fact: a string, or a node such
  as `<Code>` or a `Badge`), optional `hint` (one muted line under the value, on where it comes
  from) and optional `action` (the far end: a copy button, an edit link). `labelClassName` and
  `valueClassName` reach the two halves of the row.
- The semantics are built in. On the web: a `<dl>`, each row a `<div>` holding a `<dt>` for the
  label and a `<dd>` holding the value, the hint and the action — the hint and the action are read
  as part of the value. On device: `role="list"` and `role="listitem"`. Add no roles of your own.
- `layout="inline"` (the default) puts each label beside its value in a column the labels line up
  in, and **falls back to stacked by itself** when the list is too narrow for both — it follows the
  width the list is given, not the window. `layout="stacked"` puts the label above the value at
  every width. There is no breakpoint prop.
- A `PropertyRow` only renders inside a `DescriptionList`. A row the user *edits* is not this — it
  is a field in a form (`FormField`, or a `FormDialog` opened from the row), never a value that
  turns into an input where it sits.
- It draws no surface and no heading: put it in a `Section` (or `surface="card"`) or `CardLayout`
  `content` for those.

## Setting rows

One row of a settings page: what the setting is called and what it does at the start, the control
that changes it at the end.

```tsx
<Section
  title="Appearance"
  surface="card"
  content={
    <>
      <SettingRow
        title="Dark mode"
        description="Switch between light and dark theme."
        action={({ titleId }) => (
          <Switch aria-labelledby={titleId} checked={dark} onCheckedChange={setDark} />
        )}
      />
      <SettingRow
        title="Theme"
        action={({ titleId }) => <Select aria-labelledby={titleId} value={theme} … />}
      />
      <SettingRow
        description="Forget every turn and session. This cannot be undone."
        action={<ConfirmButton label="Clear all memory" … />}
      />
    </>
  }
/>
```

- One source for both platforms: `@cubeui/setting-row` in `/r/web` and `/r/native`.
- `title` (what the setting is called), `description` (one line on what it does), `action` (the
  control). `title` is optional for a row whose button already says what it does.
- **`action` as a function is how the title names the control.** It is handed `{ titleId,
  descriptionId }`; put `aria-labelledby={titleId}` on a switch, select or input so its name is
  the visible title rather than a second string. On the web a control that takes it can also have
  `aria-describedby={descriptionId}`. iOS does not read `aria-labelledby`, so a native call site
  that must be named on an iPhone passes `accessibilityLabel` as well. A **button** is a plain node:
  its own text is its name, and pointing it at the title would rename it.
- It **wraps rather than breaking at a width**: the control sits beside the text while both fit
  and drops under it, at the start, when they do not — following the width the row is given, not
  the window. A switch stays beside its title on a phone; a select or a wide button goes under.
  There is no breakpoint prop.
- It draws no surface, no border and no heading. Put the rows in a `Section` (`surface="card"`) or
  `CardLayout` `content`; the gap between them is the parent's.
- **`SwitchField` or `SettingRow`?** `SwitchField` (`@cubeui/switch-field`) is a lone boolean —
  the switch with its caption beside it, the whole row one hit target. Take `SettingRow` for any
  other control — a select, a button, an input — and for a switch that needs a description or
  sits at the far end of a settings card. A read-only fact is `PropertyRow`, not this; a value
  inside a form is a field (`FormField`, the bound fields).

## Stat tiles

One figure on a card — a label, the number, a line under it. A row of them is the top of a
dashboard or a status page; pressable, they are the filter over the list below.

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <StatTile label="Turns" value={formatCount(engine.turns)} />
  <StatTile label="Entities" value={formatCount(engine.entities)} hint={`${edges} edges`} />
  <StatTile label="Uptime" value={formatUptime(uptime)} hint={`v${version}`} icon={<Clock />} />
  <StatTile label="Embeddings" value={count} loading={isPending} />
</div>

// The filter tile: a toggle, one heap shown at a time.
{HEAPS.map((heap) => (
  <StatTile
    key={heap}
    label={LABELS[heap]}
    value={counts[heap]}
    selected={shown === heap}
    onPress={() => setShown(shown === heap ? null : heap)}
    valueClassName={heap === "attention" && counts[heap] > 0 ? "text-destructive" : undefined}
  />
))}
```

- One source for both platforms: `@cubeui/stat-tile`, exporting `StatTile`. On the web the press
  prop is `onClick`, as it is on the compiled `Card`.
- `label` is what the figure is called, `value` the figure — a string or number drawn large in
  tabular numerals, or a node (a `ColorDot` beside a name) placed as is — and `hint` one muted line
  under it. `icon` sits before the label; pass a bare `<Clock />`, the tile sizes and mutes it.
- `onPress` makes the whole tile one button, named by its text. **Add `selected` and it is a
  toggle**: `aria-pressed` on the web, `selected` in the accessibility state on device, drawn with
  a `selection` border; its fill stays the card's, so chosen does not look like hovered. Without `selected` it is a plain button (a tile that opens a
  page); without `onPress`, `selected` is ignored.
- `loading` keeps the label and holds the figure's place with a bar, so a row does not jump when
  the data lands. Drop the four `<Skeleton className="h-28" />`s that stood in for the row.
- `valueClassName` is for the figure's colour — a count worth noticing in `text-destructive`.
  There is no `tone` or `size` prop.
- It lays out one tile, not the row: the grid is the caller's, since the column count is the
  page's decision. A label-over-number pair with no card around it is a `DescriptionList` with
  `layout="stacked"`, not this.

## List pages

Two shells for the shape every list route is: a ladder of states, then rows.

```tsx
<QueryState query={roles} what="your roles" count={shown.length} empty={<Empty … />} />
{shown.map((role) => (
  <DisclosureRow
    key={role.id}
    open={open === role.id}
    onOpenChange={(next) => setOpen(next ? role.id : null)}
    badges={<Badge>{role.contract}</Badge>}
    title={role.name}
    meta={<span className="text-muted-foreground text-xs">{role.lanes} lanes</span>}
    description={role.prompt}
    action={<ActionButton label="Delete" … />}
    content={<RolePrompt role={role} />}
  />
))}
```

### QueryState

- The three rungs a list climbs before it is a list: the request **failed**, it has **not
  landed**, it landed **empty**. Once there are rows it renders `null`, so the page reads as the
  ladder and then the list rather than a nest of ternaries.
- `count` is what the page is **about to draw**, not what came back. A search matching nothing is
  an empty *view* over a full result, and only the page knows which of the two it is showing — so
  pass the length of the rows you are mapping, and let `empty` say which emptiness it is.
- `query` is structural: anything with `isPending`, `isError`, `error` and `refetch` fits, so the
  shell names no data library. The same line `FormField` holds against form libraries.
  `error` is `unknown` — an Apollo error, a TanStack `Error | null` and a thrown string all fit.
- **`describe`** — `(error: unknown) => string` — is what the failure means in the app's words.
  Without it the line under the heading is the error's own `message`, which is the transport's
  wording ("Failed to fetch", "Received status code 401"), or "The server did not answer." when
  there is none. An app with a `describeError` helper passes it here instead of keeping its own
  failure card: `<QueryState describe={describeError} … />`. `QueryError` takes it too.
- **Try again awaits the retry.** When `onRetry` (on `QueryState`, the query's `refetch`) returns a
  promise, the button is disabled and reads "Retrying…" until it settles, so a second press does
  not stack requests. A rejected retry is caught — Apollo's `refetch` rejects when it fails again
  — so it never surfaces as an unhandled rejection; the query's own error is what gets shown.
- It ships `QueryError` and `RowSkeleton` alongside it. Reach for `QueryError` on a page that
  draws one object rather than a list — it is the rung most often left out, and a page that draws
  a failure as an absence tells somebody whose server went away that they have no data.
  `<QueryError error={error} onRetry={refetch} what="this invoice" describe={describeError} />`.
  Its root is `role="alert"`, card and `compact` alike, because it replaces what the reader was
  waiting for — so do not wrap it in another alert.
- `RowSkeleton` draws `rows` bordered `Card`s — the shape a row is — so the page does not change
  shape when the answer lands. `rows` is 3 by default and `QueryState` passes it through. Use it on
  `isPending` only: behind `isFetching` it flashes a skeleton over a list that is perfectly good.
  The placeholders are `aria-hidden` inside one `role="status"` wrapper announcing "Loading", so
  three cards of placeholder text are not three cards of nothing to read out.
- **`compact`** draws the rungs small enough for a sidebar: the failure as two lines of text and a
  small "Try again" instead of a card, and the placeholders as bars the height of a nav row. Use
  it in a `SidebarSection`'s `status`; `QueryError` and `RowSkeleton` take it too.

### Empty states

`EmptyState` (`@cubeui/page`, on both halves) is what an empty list says. It comes in two shapes,
and which one is a question of **where the list is**, not how much there is to say:

```tsx
// The list is the page, or the page's main region: the centred block.
<EmptyState
  icon={Inbox}
  title="No agents yet"
  description="An agent runs the lanes you give it."
  action={<Button onPress={create}>New agent</Button>}
/>

// The list is inside something — a card, a sidebar section, a popover, a dialog: one line.
<EmptyState
  compact
  title="No labels yet."
  action={<Button variant="link" size="xs" onPress={create}>Add one</Button>}
/>
```

- **Default** — an icon in a muted bubble, the `title`, an optional `description`, the `action`
  under them, centred, with `py-10` around it. `icon` is required: it is a component
  (`icon={Inbox}`), not an element, and the shell sizes it.
- **`level`** (1–3) makes the title a heading of that rank, at the same size. Set it only when the
  empty state *is* the screen — a first run, a record not found, a dead link — so a screen reader
  has a heading to land on. Otherwise leave it off; the page already has its heading.
- **`compact`** is one muted `text-sm` line: an optional small `icon` inline before the words, the
  `title`, then the `action` on the same line (it wraps under on a narrow column). No bubble, no
  centring, nothing but a `py-2` — it keeps the left edge of what it sits in. It is plain text,
  never a heading, so `level` is a **type error** with `compact`, and so is `description`: the
  whole sentence goes in `title` ("No servers yet. Add one to give the agent some tools.").
  Use it for `CardLayout`'s `empty`, a compact `QueryState`'s `empty`, and the empty body of a
  popover or picker. In a `Sidebar`, `className="px-2"` lines it up with the rows.
- Do not hand-write either: not `<Text className="text-muted-foreground text-sm">No labels
  yet.</Text>`, and not an `Empty` helper in the app. Four apps wrote that line with as many
  paddings and alignments; the shell is the one place it is decided.
- **shadcn's compound form is `@cubeui/empty`, on both halves.** `Empty`, `EmptyHeader`,
  `EmptyMedia` (`variant="icon"` for the bubble), `EmptyTitle`, `EmptyDescription` and
  `EmptyContent`, with shadcn's names and props, installed to `components/ui/empty`. The block
  above is built on them, so they draw the same thing — which is not shadcn's look: the title is
  `text-sm`, not `text-lg`, and there is no `flex-1` or `p-6 md:p-12` unless a `className` asks.
  Write `EmptyState` in new code; the parts are there so a shadcn call site ports unchanged, and
  for the rare empty state that needs a second button or an image where the icon goes.
  `EmptyTitle` is plain text: give it `role="heading"` and `aria-level` yourself when it is the
  screen.

### DisclosureRow

- The **whole heading is the button**, so a row is never opened by hitting a 16-pixel chevron and
  is operable with Space. `aria-expanded` is on it, and `aria-controls` while the body is there.
- **`action` sits outside that button.** A control nested inside a button is invalid HTML and, in
  practice, a delete that cannot be clicked.
- `description` shows whether the row is open or shut; `content` is what it opens onto.
- Open is controlled — a row is often opened from elsewhere on the page, or by a deep link.
- It is built on `Item`, so a row that opens lines up with one that does not down to the padding.
  A row that does **not** open onto a body is `ListItem`, below.
- One source for both halves: `@cubeui/disclosure-row`. On a device the heading is a
  `role="button"` `Pressable` with `aria-expanded`, the title is one line (`numberOfLines`), and a
  string `meta`, `action` or `content` is wrapped in a `Text` for you; pass the badges, the action
  and the body as native elements, `onPress` where the web takes `onClick`.

### ListItem

One row of a list — an avatar or a checkbox, a name over a line, a date and a few buttons at the
far end — optionally pressable. One source for both platforms: `@cubeui/list-item`.

```tsx
{people.map((p) => (
  <ListItem
    key={p.id}
    leading={<Avatar person={p} />}
    title={`${p.firstName} ${p.lastName}`}
    description={p.email}
    meta={relativeTime(p.lastContactedAt)}
    onPress={() => router.push(`/persons/${p.id}`)}
    action={<Button size="sm" variant="ghost" onPress={() => remove(p.id)}>Delete</Button>}
  />
))}
```

- `leading` is the start of the row: an avatar, a checkbox, an icon, placed as given. It is not
  sized the way `icon` is, so size an icon yourself (`size-4`), and it is **outside** the pressed
  area — a `Checkbox` there is its own control (telos' todo row).
- `title` is one line and truncates; `description` is the muted line under it, two lines at most.
  `titleClassName` reaches the title (a done todo's `line-through`).
- `meta` is the small grey facts at the far end — a date, a count, a badge. A string is drawn
  `text-xs` muted for you. It is inside the pressed area.
- `action` is the far end, **outside** the pressed area: one button or a fragment of them. Pass
  ghost `Button`s (or `ActionButton`s); the row adds the gap.
- `onPress` (`onClick` on the web) makes the middle — `title`, `description`, `meta` — one button
  (a real `<button>` on the web, named by its text) between `leading` and `action`. Every control in the row is pressed,
  focused and announced on its own; do **not** wrap the row in a `Pressable`, a `Link` or an
  `<a>`, which is the button-in-a-button this avoids. For a route, call the router in the handler.
- No surface and no list role: the row is `rounded-md px-3 py-2.5` and nothing else. Put rows in a
  `Section`, a `CardLayout` `content` or a `<ul>` of your own; for a bordered card per row pass
  `className="rounded-lg border border-border bg-card"`.
- `ListItem` is the row with its decisions made; prefer it in new code. For one it does not fit — a header or footer
  line, a badge beside the title, a whole row that is one link — compose shadcn's `Item` parts
  (`@cubeui/item`, installed to `components/ui/item`), which are on both halves now with shadcn's
  names, props and metrics: `ItemMedia` is `leading`, `ItemContent` the middle, `ItemTitle` and
  `ItemDescription` the two lines, `ItemActions` the `action`. On a device a string in a part is
  wrapped in a `Text` for you, an icon in `ItemMedia` is not sized (pass `size-4`), and `asChild`
  hands the row to a `Pressable` the way it hands it to an `<a>` on the web.

### Table

When the rows have **columns** — the same four facts on every row, read down as well as across —
the list is a table, not a stack of `ListItem`s. `@cubeui/table` is shadcn's `Table`, `TableHeader`,
`TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell` and `TableCaption`, installed to
`components/ui/table`, so a shadcn call site keeps compiling unchanged.

```tsx
<Table>
  <TableCaption>Servers in this workspace</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead className="text-right">Tools</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {servers.map((s) => (
      <TableRow key={s.id}>
        <TableHead>{s.name}</TableHead>
        <TableCell className="text-right">{s.tools}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

- It is a primitive, so it takes `children` like shadcn's. The `QueryState` ladder goes above it
  exactly as it does above a list of rows.
- **`TableHead` scopes itself**: `scope="col"` inside `TableHeader`, `scope="row"` anywhere else.
  So the first cell of a body row — the thing the row is *about* — is a `TableHead`, not a
  `TableCell`, and a screen reader names the row before reading each cell of it. Pass `scope`
  to override.
- **A `TableCaption` names the table.** Give one to every table that is not already under a
  heading saying what it is; `className="sr-only"` keeps the name without the line.
- Too wide for its column, it scrolls sideways inside its own container rather than widening the
  page, and the container becomes a tab stop while it does so a keyboard can scroll it too.
- No sorting, filtering or pagination: nothing here uses them. Sort the array you map.
- **Web only — no native twin.** React Native has no table element, and a phone has no width for
  columns. On native, draw the same data as rows: `ListItem`s for many records, and
  `DescriptionList` / `PropertyRow` for one record's facts.
