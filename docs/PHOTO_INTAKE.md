# Photo intake

Use this checklist when a photo of a Bushnell building is ready to become part of the model. The result is a facade spec on the building record. The spec is what the facade kit in `src/facade/` draws. Do not hand-build a one-off mesh for a new photo.

The public upload page is at `/submit`. It accepts the year, the address, the photograph, and optional notes. Submissions stay pending until they are approved on `/admin`. Approved photos are marked accepted only. They are not copied into `public/photos/` or drawn in the town automatically. A person still has to walk this checklist before the spec is drawn in a year that visitors can see. The page should not invent a lot, a name, or a year. See `docs/photo-submit.md` for how the form and review page work.

## 1. Keep the file

Save the photograph at `public/photos/<building-id>.png`. Record that path as `sourcePhoto`. Do not crop a texture out of the photo. Colors are sampled as hex values. Geometry comes from the kit.

## 2. Identify the address and the lot

Read the Sanborn sheet for that block and year, then the other sources already cited in `SOURCES.md`. Write down:

- The street and the number, using the 1909 numbering already in the model (400 starts at Hurst, 500 at Hail, and the same hundreds run on the parallel streets).
- The Sanborn block, the side of the street, and the lot if the sheet prints one.
- Whether the footprint on the sheet was actually read. If it was not, the footprint is an estimate and the spec's `estimates` list must say so.

Confidence is `sourced` only when a map or a named history puts the building on that lot. A photograph that shows the front, with the lot still unread, stays an estimate for the placement even when the front itself is sourced.

## 3. Date the photograph

Use a date printed on the photograph, written on it, or given by the person who sent it. If none of those exist, leave `photoDate` empty and say so in `estimates`. Do not guess a year from the style of the facade and then treat that guess as a fact.

## 4. Count and measure

From the photograph:

- Count the floors and the bays from left to right.
- For each bay, name the window on each floor: `flat`, `segmental`, `round`, `pair`, `pair-arch`, `bay`, `storefront`, or `door`.
- Measure proportions against a known height. A door is about 7 feet. A storefront opening is about 9 to 10 feet. A brick course is about 2.7 inches. Write the floor heights in feet.
- Sample wall, trim, and roof colors with an eyedropper and store them as hex on `wall`, `trim`, and `roof.color`.

## 5. Separate original work from later alterations

A boarded window, a filled panel, a painted brick color, a pent roof, or a modern sign is an alteration unless an earlier source shows it. Put the later look in `alterations` with `from` set to the first model year after the alteration is known. The model years are 1854, 1860, 1870, 1880, 1890, 1900, 1910, 1920, 1950, 1960, and 1970.

Signs carry their own `from` and `to`. A business named only in a recent photograph is not painted on earlier years. Something Special on the East Main 400 block is the example: the sign starts at 1970.

## 6. Write the spec

Add `facadeSpec` to the building in the year file that first shows that front. Include:

- `sourcePhoto`, `photoDate`, and `citation`.
- `camera` with `year`, `x`, `z`, `lx`, and `lz`, standing on the street at eye height, aimed the way the photograph is aimed.
- `floors`, `bays`, `storefront` or `storefronts`, `cornice`, `roof`, and any `porch`, `dormer`, `pediment`, `parapet`, `medallions`, `hedge`, or `chimney`.
- `signs` with year ranges.
- `estimates` listing every placement, date, or measurement that was not read off a source.

Cite the photograph and the map in `SOURCES.md` in the same words the rest of that file uses. Do not invent a proprietor.

## 7. Check it side by side

Put the photograph in `public/photos/` at the path named by `sourcePhoto`. With the dev server running:

```
npm run compare -- <building-id>
```

The script reads `camera` from the spec, renders that view, and writes `artifacts/compare-<building-id>.png` with the source photograph on the left and the render on the right. Change the camera, the focal length, and the spec until the render reads as the same building: the same viewpoint, bay count, window shapes, proportions, colors, and roof. Do that before the front is treated as finished.

## 8. What the upload page does not do

The checklist above is still the part a person does. The upload page only collects the file, the claimed address, the claimed year, and optional notes. Approving a photo marks it accepted. It does not choose a lot, sample colors, or publish the spec. Those stay on this checklist until someone has compared the render with the photograph.
