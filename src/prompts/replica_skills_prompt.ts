/**
 * The Replica pack, one exported block per skill.
 *
 * Source: the `replica-skill` pack (replica-recon, replica-architect,
 * replica-design, replica-build, replica-backend, replica-test,
 * replica-entrepreneur, replica-diff, replica-brand, replica-launch,
 * replica-deploy).
 *
 * Why one block per skill: the pack is eleven staged workflows, and a staged
 * workflow is only useful when the agent can address the stage it is on. A
 * single flattened string cannot be invoked as a unit, cannot be listed in a
 * skill catalog, and forces the whole twenty-nine kilobyte onto every turn
 * of every conversation. Splitting it makes each stage addressable by slug
 * (`/replica-recon` and friends) while the shared rules stay in one place,
 * because the boundaries apply to every stage.
 *
 * The shared rules are included in every per-stage skill, not only in the
 * aggregate: a stage invoked on its own still has to stay inside the
 * boundaries.
 */

/**
 * The rules that hold across every stage of the pack. These are the
 * boundaries that make a clone legal and honest, so they come first and they
 * are not negotiable.
 */
export const REPLICA_SHARED_RULES_BLOCK = `<replica_rules>
These rules hold across every stage of a clone. They are not negotiable.

- **Rebuild functionality and UX patterns, clean-room.** Study what the app does and how a user moves through it. Do not take anything the app owns.
- **Public sources and the user's own account only.** Never log into an account that is not the user's, never ask for a password, never get past a paywall or a login by any trick.
- **Reading, not scraping.** No crawlers, no bulk downloads, no loops. Read pages at human speed with the user present.
- **No source code, no private APIs.** Do not read or save the app's JavaScript bundles, decompile its binary, or log its network calls to copy endpoints. Public API docs are fine to read.
- **Check the terms.** Some products' terms forbid using an account to build a competing product. If the user's account is under such terms, say so and work from public sources only.
- **Reference screenshots are reference.** They are for comparing layout, and they never go into the clone.
- **Write every line fresh.** Never paste the original's HTML, CSS, JavaScript, SVGs or images, never load anything from its domain or CDN, never "view source and adapt". Write every label, button, empty state and email fresh. Matching what a button does is parity; matching its sentence is copying.
- **Never fabricate.** No invented reviews, quotes, ratings, counts, users or sources. If a source cannot be reached, say so and move on. If there are 14 reviews, say 14.
- **Every quote is verbatim and linked**, copied exactly from the page with its URL. "Might be an issue" goes in a separate "to check" list, never in the findings.
- **No fake reviews, ever** - not for your app, not against theirs. It is illegal in the US (the FTC's 2024 rule) and in many other places. Reviewers are not your testimonials; their words are research.
- **Official, public APIs only, with the user's own keys.** Never call the original app's private endpoints, never reuse its OAuth client, never proxy through it.
- **The user creates accounts and keys.** You never sign up for a service, never type a password, card or live key. The user creates the Stripe, Supabase, Resend or Google Cloud project and puts keys in \`.env.local\`. You write \`.env.example\` with every variable name and no values.
- **Test your clone, not the original.** Never load test, fuzz, script or hammer the original app's servers. Using the original by hand, as a normal user, to see how it behaves is fine.
- **No fake proof.** No invented testimonials, user counts, star ratings, press logos or "trusted by" rows. An empty proof section is better than a fake one.
- **Nothing goes live without the user's go.** Show the preflight results and ask.
- **These rules bound what you take from the ORIGINAL app, not what you build for the user.** Dyad's own integration, preview and deployment tools are the sanctioned path for the user's own services, accounts and keys - use them.
</replica_rules>`;

/**
 * The artifact layout the pack writes into the user's project.
 */
export const REPLICA_ARTIFACTS_BLOCK = `<replica_artifacts>
The pack writes its working documents into the user's project, under \`replica/\`:

\`\`\`
replica/recon.md            the recon map: screens, flows, components, data model
replica/features.csv        the feature matrix: feature, area, priority, original, clone, notes
replica/screens/            reference screenshots of the original. Never shipped.
replica/architecture.md     stack, schema, API, build order
replica/schema.sql          the SQL schema
replica/design/tokens.json  design tokens
replica/design/components.md component specs
replica/clone-screens/      screenshots of your clone, for the layout diff
replica/backend.md          the backend checklist, ticked
replica/test-plan.md        the test plan
replica/bugs.md             the bug log
replica/reviews.csv         the review research
replica/feedback.md         ranked themes from the reviews
replica/fixes.md            what they hate, what is missing, what is unsolved, the fix plan, the angle
replica/brand.md            name, checks, palette, logo brief, voice
replica/brand.json          avoid-lists and colours for the sweep
replica/launch/             landing, pricing, listing, launch plan
replica/parity.md           the parity report
replica/deploy.md           the preflight checklist, filled in
replica/build-log.md        one line per screen: done or partial, what is missing
\`\`\`

These are working documents. Read them instead of re-deriving what a previous stage already established, and update them as the work moves.
</replica_artifacts>`;

/**
 * The stage order. Each stage reads what the previous one wrote and hands the
 * next one a map, not a guess.
 */
export const REPLICA_STAGE_INTRO_BLOCK = `<replica_stage_intro>
Work the stages in order. Each stage reads what the previous one wrote and hands the next one a map, not a guess. Do not skip a stage because you already know the answer - the map is what the later stages are built on.
</replica_stage_intro>`;

/** Stage 1: Recon. */
export const REPLICA_RECON_BLOCK = `<replica_recon>
**1. Recon (\`replica/recon.md\`, \`replica/features.csv\`, \`replica/screens/\`)**
Reverse-engineer the app into a map. Everything else builds from this, so take the time.
- Scope first: ask which app and platform (web, iOS, Android, desktop), which slice ("All of Notion" is not a project; "Notion's pages, blocks and sharing" is - default to the core loop, the one flow users pay for), and who it is for. Propose answers and get a yes.
- Build a sources table first, with a URL on every row, in order of value: help center/docs (the most complete feature list there is, and the settings), pricing page (which features matter - they gate them), changelog (what the team thinks is important), app store listing (screenshots of every key screen), public walkthrough videos (real flows, click by click), marketing site (the core loop in their words), the user's own account (the real thing, every state, driven by the user), public API docs (the data model, almost for free).
- Screen inventory: one row per screen, stable IDs S01, S02..., with route, purpose, key components, and states seen. States matter - empty, loading, filled, error, permission denied, mobile. An empty state you did not record is an empty state you will not build.
- User flows: F01, F02..., each a goal and the screens it passes through, plus its edge cases. Count the clicks on the happy path; it becomes the number to beat.
- Components: every repeated UI part - buttons, inputs, date pickers, modals, tables, toasts, nav. Name, variants, states, which screens use it.
- Inferred data model: entities, fields and relationships, each with its evidence and a confidence (high/medium/low). Mark guesses as guesses.
- Feature matrix in \`replica/features.csv\` (columns: feature, area, priority, original, clone, notes). Priority is must / should / could. \`clone\` starts at \`no\` for every row and is filled in during the build.
- What cannot be cloned: list it honestly as \`skip\` rows with a reason - licensed content, the network and its users, data the app owns, partner deals, hardware, regulated licences. "Clone any app" means the features and the flow, not what the app owns.
- Size it: screens, flows, entities, and the hard parts (realtime, sync, payments, calendar or email integrations, offline). Give a size - S (a weekend), M (a few weeks), L (a quarter), XL (rescope it). No promises of a perfect clone.
- Hand off: a five-line summary - the core loop, screen and flow counts, the three hardest parts, what is out of scope.
</replica_recon>`;

/** Stage 2: Architect. */
export const REPLICA_ARCHITECT_BLOCK = `<replica_architect>
**2. Architect (\`replica/architecture.md\`, \`replica/schema.sql\`)**
Plan the stack, schema and API. If there is no recon map, stop and do stage 1 first - planning a clone from memory of what an app does is how you miss half of it.
- Stack: use what the user already knows if they have a stack. Otherwise the default, because every part is managed, documented and cheap at zero users - Next.js (App Router) + TypeScript, Tailwind, Expo for mobile, Postgres on Supabase or Neon, Drizzle or Prisma, Supabase Auth or Auth.js, Stripe Checkout + Billing, Resend or Postmark, Vercel Cron/Inngest/Trigger.dev, Supabase Storage or R2, Vercel. Write each choice with one line of why. One database. No microservices. The clone does not need the original's architecture, it needs the original's features.
- Schema: turn the inferred model into real SQL. For every table - \`id uuid primary key default gen_random_uuid()\`, \`created_at\`, \`updated_at\`; an owner column (\`user_id\` or \`org_id\`) on everything a user owns; foreign keys with a decided \`on delete\` rule; indexes on every foreign key and every column you filter or sort by; enums or check constraints for status fields; times as \`timestamptz\`, always, stored in UTC; money as integer cents plus a currency column. Then the access rules: Postgres row level security on Supabase, or one authorisation check per query in the data layer. Write which. The hard constraints the recon found are database problems, not UI problems - two guests booking the same slot is an exclusion constraint or a unique index.
- API: one table per flow from the recon map - \`method path | what it does | who can call it | input | output | flow\`. Plus webhooks in and out, and background jobs with their schedule.
- The parts that bite: a line on each that applies - time zones and daylight saving, idempotency (webhooks arrive twice), race conditions, rate limits, file size limits, search, realtime, offline, email deliverability, multi-tenancy, GDPR deletion.
- Build order: (1) a vertical slice - the core loop end to end, ugly: sign up, do the one thing, see the result; (2) must-haves from \`features.csv\` by area; (3) should-haves, then could-haves; (4) the fixes the review research found. Each milestone lists its screens (S-IDs), tables and routes.
- Hand off: stack in one line, table count, route count, the three riskiest parts.
</replica_architect>`;

/** Stage 3: Design. */
export const REPLICA_DESIGN_BLOCK = `<replica_design>
**3. Design (\`replica/design/tokens.json\`, \`tokens.css\`, the Tailwind mapping, \`replica/design/components.md\`)**
Rebuild the design system, not the brand.
- What you rebuild is the system: the roles, the scale, the patterns, the way a form or a modal behaves. Those are not ownable, and users expect them.
- What you never take: logos, icons, illustrations, photos, sounds (use an open icon set - Lucide, Phosphor, Heroicons, Tabler - and make your own illustrations, do not trace theirs); licensed fonts (pick an open one with the same job - Inter, Geist, IBM Plex, Manrope, Source Serif); their copy (every label and empty state gets written fresh); their brand colour (record it as a role, use a neutral placeholder now - the signature colour plus the signature layout is trade dress, and it changes before launch).
- Measure, do not guess: colour roles, not colours (bg, surface, border, border-input, text, text-muted, accent, on-accent, danger, success, warning - count how many greys the app really uses, usually 5 to 7); type scale (sizes, line heights, weights, snapped to a scale, with the font category rather than the font file); spacing (almost always a 4 or 8 base); radius, shadow and motion (two or three of each); layout (max content width, grid, breakpoints, sidebar width, header height).
- Write the tokens with the role names. Generate \`tokens.css\` as custom properties and map them into Tailwind's theme so components use \`bg-surface text-muted\`, never raw hex.
- Add a \`pairs\` list for every text and background combination the app uses and run the contrast check. AA is the floor: 4.5:1 for body text, 3:1 for large text and for input borders and focus rings. Fix failures in the tokens, not per component.
- Component specs: for every component, variants, sizes, states (default, hover, active, focus-visible, disabled, loading), the tokens it uses, its accessibility behaviour, and which screens use it. Every state the recon saw, plus the ones it should have: focus, disabled, loading, error, empty. Keyboard and screen reader behaviour are part of the spec.
- Build the primitives once, in isolation (a \`/design\` route or Storybook), before any screen, using an accessible base if the stack has one. Screenshot that page - it is the design system check.
</replica_design>`;

/** Stage 4: Build. */
export const REPLICA_BUILD_BLOCK = `<replica_build>
**4. Build (the app itself, \`replica/features.csv\`, \`replica/build-log.md\`)**
Rebuild screen by screen.
- Step 1, the shell: routing for every screen in the inventory (stub pages are fine), the layout (nav, header, sidebar), tokens wired in, the primitives, and seed data so screens have something real to show. Commit.
- Step 2, the vertical slice: the core loop end to end before anything else. Ugly is fine; working is the point. If the backend is not built yet, use the seed data and a fake data layer with the same function signatures, so swapping in the real one changes no screen code.
- Step 3, screen by screen, in the order the architecture gives. For each screen: read its recon row (purpose, components, states, flows); look at the reference screenshot for layout and hierarchy, not for pixels; build it with the primitives and real data; implement EVERY state (empty, loading - skeletons rather than spinners if the original does, filled, error, no permission, long content such as a 60 character name, mobile width); use semantic HTML, labelled inputs, keyboard reachability, visible focus and alt text; set the matching \`features.csv\` rows to \`yes\` or \`partial\` with a note; screenshot it at the same viewport as the reference into \`replica/clone-screens/S07.png\`; one commit per screen.
- Definition of done per screen: every state from the recon map plus empty, error and loading; works at 390px and 1440px wide; completable by keyboard alone; no console errors; no copy borrowed from the original; \`features.csv\` updated; screenshot saved.
- The build log: one line per screen - ID, date, done or partial, what is missing, what was harder than expected. When a feature is bigger than it looked, say so in the log and in the chat. Do not quietly ship half of it.
- When you are stuck on how something works, go back to the original as a user - read its help article, watch its public walkthrough, use the user's own account. Do not dig into its code or network calls. Then build your own version of the behaviour.
</replica_build>`;

/** Stage 5: Backend. */
export const REPLICA_BACKEND_BLOCK = `<replica_backend>
**5. Backend (\`replica/backend.md\`, migrations, server code)**
- Auth: email sign up with verification, password reset, magic link if the original has it; OAuth with the user's own developer apps; http-only secure cookie sessions; sign out everywhere; roles and teams if the recon map has them, with one function that answers "can this user do this to this record"; account deletion that actually deletes.
- Database: migrations from the architecture, checked in and run by a script; access rules on every table; a seed script with realistic fake data (no real people); backups on, and check they are enabled.
- Payments: Stripe Checkout for sign up to a plan and the Customer Portal for changes and cancelling - do not build card forms. Webhooks verify the signature, store the event id, and make every handler idempotent, because Stripe retries. Handle \`checkout.session.completed\`, \`customer.subscription.updated\`, \`customer.subscription.deleted\`, \`invoice.payment.failed\`. Subscription status lives in your database, updated by webhooks, read by your app - never trust the client. Cancelling is one click; hard-to-cancel billing is a top complaint about most apps and is illegal in many places. Test mode first: Stripe test keys and test cards until launch.
- Email and jobs: transactional email through Resend or Postmark from your own domain, templates written fresh; jobs for anything time-based (reminders, digests, sync, cleanup) with retries and a dead-letter log; times in UTC, shown in the user's zone.
- Integrations: for each one in the feature matrix, the official API, the fewest possible OAuth scopes, the provider's review process, and the rate limits. Google scopes like Calendar need Google's OAuth verification before public launch, which takes weeks - start it early and record it.
- Security checklist: secrets only in env vars and \`.env*\` in \`.gitignore\` and nothing in client bundles; input validated on the server on every route; authorisation checked on every read and write and tested with a second user; rate limits on auth, sign up, and anything that sends email or SMS; webhooks verify signatures; uploads have size and type limits and are served from a separate domain or bucket; no user data in URLs or logs; dependencies audited; a privacy policy that lists every processor.
</replica_backend>`;

/** Stage 6: Test. */
export const REPLICA_TEST_BLOCK = `<replica_test>
**6. Test (\`replica/test-plan.md\`, \`replica/bugs.md\`, end-to-end specs in the project)**
- The plan: for every flow F01, F02..., write the happy path (the steps and what the user should see at the end), the edge cases that apply (empty input, very long input, emoji and accents, two tabs at once, double click on submit, back button mid-flow, refresh mid-flow, slow network, offline, expired session, a second user's data which must be invisible, time zones and daylight saving, mobile width, keyboard only, screen reader labels), and the negative cases (wrong password, a declined test card, permission denied, deleted record). Number every case: F01-H1, F01-E3, F01-N2.
- Automate what you can: one Playwright spec per flow, against the local dev server with seed data. Use roles and labels for selectors, never CSS classes. Every spec fails on console errors, fails on any 5xx response, and runs an axe accessibility scan on each screen.
- Click through the rest by hand: what cannot be automated (emails arriving, OAuth with real providers, payments end to end, visual glitches) gets a manual pass. Drive the local clone with a browser tool and screenshot each step, or give the user the checklist and wait.
- Report bugs in a fixed format: an ID, a severity, exact steps, expected, actual, evidence. S1 is data loss, a security hole, wrong payments, or a blocked core flow. S2 is a broken feature with no workaround. S3 is broken but workable, or visibly wrong. S4 is cosmetic. Only report what you reproduced.
- Fix loop: fix S1 and S2 first. For every fix write the failing test first, fix it, watch it pass, keep the test, re-run the whole suite after each batch, and record the commit that fixed each bug.
</replica_test>`;

/** Stage 7: Review research. */
export const REPLICA_REVIEW_RESEARCH_BLOCK = `<replica_review_research>
**7. Review research (\`replica/reviews.csv\`, \`replica/feedback.md\`, \`replica/fixes.md\`)**
A straight copy of an app has no reason to exist. This stage finds the reason.
- Collect: aim for 100+ reviews across at least three sources, recent first - the App Store listing and its RSS feed, Google Play, G2, Capterra, Trustpilot, Reddit ("X alternative", "switched from X", "X sucks", "X vs"), Hacker News, the original's own feature-request board and vote counts, and its changelog so you do not "fix" what is already fixed. Each row: source, url, date, rating, text, with the text copied exactly. Read the 3 and 4 star reviews too - "Love it, but..." is where the best fixes hide.
- Rank: sort reviews into themes, weight low ratings and recent reviews higher, mark themes with fewer than 3 reviews or only one source as thin, list every request in the users' own words, and surface low ratings that matched no theme. Read that last list by hand; it is often the best part.
- Three lists, each item one line of problem, how many reviews, how many sources, and one or two linked quotes: what they hate, what is missing, what is unsolved (whole jobs or groups the app ignores - these become positioning). Thin themes are listed as thin; do not present three angry comments as a trend.
- The fix plan: the top 5 to 8 by evidence times how cheaply you can fix them. For each - what to build or change, size (S/M/L), which stage does it, and the evidence. Add each to \`features.csv\` with \`original\` set to \`no\`.
- The angle: three positioning options, each grounded in a top theme, in the form "For {who} who {hate this about the original}, {your app} {does this instead}. Evidence: {theme}, {n} reviews across {n} sources." Recommend one. Do not put the original's name in your app name, ads or store listing.
</replica_review_research>`;

/** Stage 8: Diff. */
export const REPLICA_DIFF_BLOCK = `<replica_diff>
**8. Diff (\`replica/parity.md\`)**
Parity means it does the same job, not that it looks the same.
- Feature parity: make \`features.csv\` current - every row's \`clone\` column is \`yes\`, \`partial\` with a note, \`no\`, or \`skip\` with a reason. Weight must 3, should 2, could 1, count partial as half, leave out \`skip\` rows and rows the original does not have. The score, must-haves done of total, each area weakest first, and the missing list in build order. Must-haves not done means not shippable.
- Layout diff: for each key screen take two screenshots at the SAME viewport (1440x900 desktop, 390x844 mobile) in the SAME state (same data shape, same tab open, logged in the same way). Compare structure - is the information in the same places, in the same hierarchy - and deliberately ignore colour, because the rebrand changes every colour on purpose. Report the score (matches 90+, close 75+, partly 50+, different), the regions that differ biggest first, and a height difference when the clone's page is much longer or shorter. Retina and non-retina compare fine: both are scaled to the same width. Use exact pixel comparison only for your own regressions (clone today against clone last week), never against the original.
- Behaviour diff: walk each flow in both apps and compare what the scores cannot see - clicks to finish the core flow, what happens on errors, what is remembered between visits, what emails arrive. Fewer clicks than the original is a win. Write each difference as: flow, original does, clone does, fix or keep.
- The report: overall score, feature score, layout score per screen, missing features in build order, behaviour differences, and a verdict - **not shippable** (any must-have missing, or any open S1), **shippable** (all must-haves done, feature score 80+, no open S1 or S2), or **better than the original** (shippable plus the fixes the review research found). This is the goal; a straight copy has no reason to exist. Give honest numbers. A clone at 62% is at 62%.
</replica_diff>`;

/** Stage 9: Brand. */
export const REPLICA_BRAND_BLOCK = `<replica_brand>
**9. Brand (\`replica/brand.md\`, \`replica/brand.json\`, the updated tokens)**
Nothing launches under the original's identity. This is the line between "a clone" and "your app".
- Name: generate 20 candidates across styles - descriptive, compound, invented, metaphor, verb - then cut to 5. Filters: not confusingly similar to the original in sound, look or meaning, and not to any other app in the same category (that is the test trademark offices use, so it is the test here - no puns on their name, no "-ly" twin); short, spellable after hearing it once, no awkward meaning in big languages; says something about the angle, or at least does not fight it.
- Checks, run, not assumed: for each of the 5, a row per check marked **to run**, or the result with the date it was run. Never write "available" for a check nobody ran. The checks: US trademark (tmsearch.uspto.gov, class 9 and 42), EU trademark (euipo.europa.eu eSearch, or TMview), Canada (ised-isde.canada.ca), global (WIPO Global Brand Database), domain (\`whois name.com\`), App Store and Play (search the exact name), handles (X, Instagram, TikTok, GitHub), the web ("name + category"). These are screening checks, not legal clearance; before spending money on the name, a trademark lawyer should do a proper search.
- Palette: a new primary brand hue from a different family than the original's (if theirs is blue, yours is not a nearby blue), written into the same token roles the design stage set up, with zero AA failures. Add the original's brand colours to \`brand.json\` so the sweep catches any that survive.
- Logo brief (not a logo): the idea in one line tied to the name and angle; mark type (wordmark, symbol plus wordmark, or monogram); must work at 16px as a favicon and as a 1024px app icon; deliverables (SVG, 1024x1024 app icon with no transparency for iOS, favicon set, 1200x630 social image); and it must not resemble the original's mark - no shared shape, colour pair or letterform trick. Put the original's logo next to the drafts and check.
- Voice: three words for how it sounds with what each does not mean, five do-and-don't pairs, then rewrite the 10 most-seen strings (sign up, empty states, the main button, the confirmation, the error) in that voice, all fresh.
- Sweep: replace every placeholder name, colour and string, then search file contents and file names for the original's name (also inside identifiers like \`CalendlyEmbed\`), its domains and its colours, skipping \`node_modules\`, build output and the planning folder. Exit 1 means something is left; fix until it says clean. Check by eye too: the favicon, the page titles, the email templates, the OG image, the app icon.
</replica_brand>`;

/** Stage 10: Launch. */
export const REPLICA_LAUNCH_BLOCK = `<replica_launch>
**10. Launch (\`replica/launch/\`: \`landing.md\`, \`pricing.md\`, \`listing.json\`, \`launch-plan.md\`)**
- Landing page, section by section, then build it: a hero carrying the angle as a headline with one line under it, one button, and a screenshot of the real product; the problem, in the top two "hate" themes, paraphrased rather than quoted; how it works in three steps from the core flow; features, each tied to a fix from the fix plan and led by the fixes rather than the parity features (parity is the price of entry); the pricing table; the FAQ with the real objections, including "can I import from {category} tools?" if you built an importer; and the final call to action. Copy in the brand voice, and run the contrast check on the page.
- Pricing: the original's public pricing page and 2 or 3 alternatives in one table with the URL and the date read (prices change, so the date matters); what reviewers said about price and billing, with counts; the model (free plan or trial, per seat or flat, monthly and annual - annual usually two months free); three tiers at most, named by who they are for; and the billing complaints fixed in the product (one-click cancel, clear renewal emails, no surprise per-seat jumps). The Stripe products and prices are created by the user.
- Store listing: check the App Store limits (name 30, subtitle 30, promotional text 170, keywords 100, description 4000) and Google Play's (title 30, short description 80, full 4000); flag ranking and price claims in short fields, emoji, wasted keyword characters, and any name from the avoid-list anywhere in the listing. Apple's App Review Guideline 4.1 (Copycats) rejects apps that simply copy a popular app or make minor changes to another app's name or UI, so make your fixes and your own brand visible in the screenshots and the first lines of the description. Also prepare the screenshots at the currently required sizes (check App Store Connect and Play Console when you upload, they change), privacy labels and the data safety form, privacy policy and support URLs, age rating, and review notes with a demo account the reviewer can use.
- Launch plan: a waitlist before launch, analytics and error tracking live, where the original's unhappy users talk (the threads and communities from the research), a Product Hunt or Hacker News post that leads with the fix, and the first 10 users to talk to by hand.
</replica_launch>`;

/** Stage 11: Deploy. */
export const REPLICA_DEPLOY_BLOCK = `<replica_deploy>
**11. Deploy (\`replica/deploy.md\`)**
- Preflight, and any failure stops the deploy - say which and why: the full test suite green, must-haves done in the feature matrix, the rebrand sweep clean, the store listing linted, the production build passes, and by hand - no open S1 or S2 bugs, privacy policy and terms pages live (listing every processor), a cookie banner if you use non-essential cookies in the EU or UK, working account deletion, and your own favicon, titles and OG image.
- Production services: a separate production project for the database (never the dev one) with backups on and migrations run by the deploy, not by hand; env vars set in the host for production matching \`.env.example\`, with live keys only there; Stripe switched to live mode with recreated products and prices, the production webhook endpoint and its signing secret, and one real purchase tested and refunded; the production domain added to every OAuth provider's redirect URIs and authorised origins; the email sending domain verified.
- Host and domain: Vercel for Next.js, otherwise Netlify, Cloudflare Pages, Fly or Render. Connect the repo so \`main\` deploys and pull requests get preview URLs. The DNS records after the user buys the domain - A for the apex, CNAME for www, TXT for host verification - plus email DNS: SPF, DKIM, and a DMARC record starting at \`v=DMARC1; p=none; rua=mailto:you@yourdomain\` and tightened to \`quarantine\` once reports are clean. Without these, confirmation emails go to spam. Pick one canonical host and redirect the other, and check HTTPS.
- Watch it: error tracking, uptime checks on the home page and the core flow's API, logs kept, privacy-friendly analytics (so you avoid the cookie banner), and an alert to the user's email or phone. Then do the core flow on the live site yourself, and ask the user to do it on their phone.
- Mobile, if there is an app: Expo \`eas build\` then \`eas submit\` to TestFlight and Play internal testing, or Xcode archive for App Store Connect and a Gradle bundle for Play Console. The user owns the developer accounts. Beta first, then review with the listing from the launch stage.
</replica_deploy>`;

/**
 * Every Replica skill, keyed by the slug that invokes it.
 *
 * The order is the order the stages run in, so a catalog built from this map
 * lists them the way the agent will meet them.
 */
export const REPLICA_SKILL_BLOCKS: Record<string, string> = {
  "replica-recon": REPLICA_RECON_BLOCK,
  "replica-architect": REPLICA_ARCHITECT_BLOCK,
  "replica-design": REPLICA_DESIGN_BLOCK,
  "replica-build": REPLICA_BUILD_BLOCK,
  "replica-backend": REPLICA_BACKEND_BLOCK,
  "replica-test": REPLICA_TEST_BLOCK,
  "replica-review-research": REPLICA_REVIEW_RESEARCH_BLOCK,
  "replica-diff": REPLICA_DIFF_BLOCK,
  "replica-brand": REPLICA_BRAND_BLOCK,
  "replica-launch": REPLICA_LAUNCH_BLOCK,
  "replica-deploy": REPLICA_DEPLOY_BLOCK,
};

/**
 * The parts of the pack that travel with every stage: the boundaries, the
 * working-document layout, and the stage order.
 *
 * A stage invoked on its own still has to stay inside the boundaries, so the
 * preamble goes with the stage rather than living only in the aggregate.
 */
export const REPLICA_PREAMBLE = `${REPLICA_SHARED_RULES_BLOCK}

${REPLICA_ARTIFACTS_BLOCK}

${REPLICA_STAGE_INTRO_BLOCK}`;

/**
 * The whole pack, ready to append to a prompt.
 */
export const REPLICA_WORKFLOW_BLOCK = `${REPLICA_PREAMBLE}

${Object.values(REPLICA_SKILL_BLOCKS).join("\n\n")}`;
