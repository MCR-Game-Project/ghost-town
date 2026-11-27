# Our Town: Business Notes and Agreement Rules

Working notes from Mark Rauschert, Nov 27, 2026. A draft, not legal language yet.
Prices are rough estimates, not market research.

## Product

- Our Town is a walkable 3D historical recreation of a town through its eras.
- Bushnell, Illinois stays free as the showcase.
- Customers are chambers of commerce, historical societies, and similar groups that pay to have their town built.

## Pricing (draft)

- **Build fee:** about $2,500–$7,500 per town, depending on its size and how many eras it covers. This is what Mark charges, mostly for his time. Out-of-pocket cost per town is small: hosting is near zero, plus maybe a few hundred dollars for maps, photos and records.
- **Yearly plan:** about $300–$1,200 a year for hosting, updates, and photo uploads. A flat plan, not a charge per user.
- **Extras:** new eras, school lesson packages, and kiosk mode for museums and libraries.
- **Founding offer:** about half price for the first 1–2 nearby towns, in exchange for a testimonial.
- Grants (state humanities councils, tourism, anniversaries) can fund towns, so provide quotes they can attach to grant applications.

- **Ad prices (proposal):** public and transparent. Ads are priced by monthly visits to the town, not by user accounts, since most visitors never sign up. Start with a flat monthly price for each kind of spot (storefront or wall sign, billboard, sidebar), in town-size tiers. Move a town up a tier once its real visit counts show it's busier. Actual dollar amounts are still to be set.

## Delivery

- Web first. Each town gets its own address (e.g. `bushnell.saxohnsizem.com`, or its own domain later). No login and no download for visitors.
- Logins only for administrators and reviewers.
- "Save to home screen" so it acts like an app on phones. Hold off on the app stores, which take a 15–30% cut and review every update.
- Hosted on Cloudflare: Pages for the town, plus Workers, R2 and D1 for uploads, accounts and data. Traffic cost stays low even at thousands of users.

## Agreement rules (draft)

1. **Town Administrator.** Every town names an administrator at registration. They review and approve or deny submissions for their town.
2. **Two-working-day review limit.** A submission not reviewed within 2 business days moves automatically to Mark's queue, and both are alerted. Mark can override any decision at any time.
3. **Ad and sign placement.** Mark alone approves all in-town sign and billboard placements. Town administrators can't approve them.
4. **Period-correct sponsor signs.** In-town signs fit the era (painted wall signs in early years, billboards from the 1950s on) and are marked as sponsors so they aren't mistaken for real history.
5. **Sponsor sidebar.** Paid sponsors can appear in a sidebar panel with logos and links, outside the 3D view.
6. **Ad revenue royalty to the town's sponsoring group** (chamber of commerce, historical society, etc.):
   - Paid as a commission rate on the town's ad revenue (example: 15%; the rate is set per agreement).
   - **Every check is $100 or more. No check is issued for less than $100.**
   - Commissions count only if earned within a rolling 12-month period. Commission older than 12 months expires and is not paid.
   - The unexpired balance has to be at $100 or more on the day a check is cut. If it reached $100 but older months expired before payment and it fell back below $100, nothing is paid until it climbs back to $100.
   - After a check is paid, the balance starts again at $0.
   - Example: at 15% earning $12 a month, the town is paid once the unexpired balance reaches $100 (about month 9). At $1 a month, the balance never reaches $100 within 12 months, so nothing is paid.
7. **Open contributions.** Anyone can contribute photos or history about a town's buildings, culture, or events.
8. **Accuracy pre-check.** Every contribution is checked by the software for accuracy before it reaches the town administrator: dates against the town's known timeline, addresses against the map, duplicates, image quality, and spam.
9. **Photo upload batches.** There's no lifetime limit on how many photos a person can contribute. Everyone starts at up to 10 photos per batch. Each time most of a batch is approved (at least 8 out of 10, confirmed by Mark), that person's batch size doubles: 10, 20, 40, 80, and so on. If most of a batch is denied, they drop back to 10.
10. **Review flow:** contributor → software accuracy check → town administrator (2 business days) → Mark if overdue or flagged → published. Denials include a short reason. Denied items are deleted after 30 days.

## Features to add

- **Event history:** disasters (fires, floods, tornadoes), trade fairs, carnivals, parades and other community events, tied to dates and places in the town.
- Review queue with daily alerts for administrators and Mark.
- Upload batch sizes that grow with approvals (rule 9), and a bot check.
- Per-town sponsor management (sign spots, sidebar, revenue tracking, royalty statements).

## Open questions

- Who keeps the ad money: the town, Mark, or a split? (The draft above assumes Mark collects and pays the town a commission.)
- Commission rate.
- Dollar amounts for each ad spot and town-size tier.
- Final build-fee and yearly-plan prices after timing a second town.
