# Sources

Ghost Town is a picture of downtown Bushnell, McDonough County, Illinois, about 1880. The streets and the railroad are taken from the old plat and from maps. Named buildings are taken from the county histories and the 1954 centennial book. Everything else is marked `inferred` in `public/data/bushnell-1880.json`.

Distances in the model are in feet. The origin is the middle of Hail Street on the centerline of the Chicago, Burlington & Quincy tracks. In the town file, positive x runs northeast along those tracks, and positive z is the side where West Main was first drawn. That side is geographic east once x points northeast, which had put East Main on the west side of the tracks and West Main on the east. The viewer mirrors that axis before drawing, so East Main is on the east side of the railroad and West Main is on the west. It then turns the whole plat so north in the scene is true north. The Burlington through downtown bears about 29.8 degrees east of north, measured on the present BNSF centerline, which is the same graded line.

## Street names

Hail and Hurst are the real names, spelled that way. Hail Street is named for John D. Hail of Macomb, one of the three men who laid the town out. The city still addresses City Hall at 138 East Hail Street. Hurst Street is the next street southwest of Hail. There is no Hale Street.

The other downtown streets used here, in the order they still stand, are:

- Southwest to northeast, crossing the tracks: Davis, Barnes, Hurst, Hail, Gridley, Wells, Twyman. Twyman is one block northeast of Wells, the same 420-foot module, and it is where the 1875 school stands. Osborne continues farther northeast, outside this model.
- Northwest to southeast, parallel to the tracks: Washington, Jackson, Dean, West Main, the railroad ground, East Main, Crafford, Rile, Sperry. Cole Street is one street farther east.

Crafford is the spelling in the centennial history and on the modern street. The 1886 fire-insurance map is hard to read at that label, and a scan sometimes looks like Crawford. The model uses Crafford.

East Main and West Main are two streets, not one street cut in half. They are the two wide streets the plat put on either side of the railroad.

## The 1854 plat

The 1885 county history describes the original survey, and the same account is repeated in the centennial book.

- The town was laid out in 1854 on the northeast quarter of section 33, before the railroad was finished.
- John D. Hail sold a two-thirds interest to D. P. Wells and Iverson L. Twyman. County surveyor William H. Rile laid the town out under their direction.
- The streets were run parallel to the railroad, which crossed the quarter on a diagonal.
- The quarter was divided into 48 blocks of 12 lots. Each block was 360 feet square.
- Two streets parallel to the railroad, one on each side, were 70 feet wide. All other streets were 60 feet.
- The proprietors gave the town two blocks for parks, one east of the railroad and one west.
- The town was named for Nehemiah Bushnell, then president of the Northern Cross Railroad, which became the Chicago, Burlington & Quincy.

A 360-foot block plus a 60-foot street is 420 feet from the center of one street to the center of the next. Measuring today's streets (OpenStreetMap, 2026) gives that same spacing, about 128 meters, and the same 70-foot mains with a wide railroad reserve between them. The downtown grid is still the 1854 plat. The model uses those survey numbers, not a traced scan.

The twelve lots inside each block are drawn as six 60-foot lots facing each of the two parallel streets, with a mid-block alley. That is the ordinary split for a square block of twelve lots. The histories say there were twelve lots. They do not print the lot lines, so the split is inferred.

Which two blocks were the parks is also inferred. The business block of Hail Street, from East Main to Crafford, was called German row and was paved as a business street in 1900, so it was not the park. The National Hotel stood on Crafford opposite the East Park. The model puts the East Park on the Barnes–Hurst block between East Main and Crafford, and the West Park on the matching block west of the tracks. The trees are the soft maples Elias Beaver set in the parks. The bandstand is remembered in the centennial book and may be a little later than 1880.

## The railroads

The Northern Cross, later the Chicago, Burlington & Quincy, was already graded through the town site in 1854. It runs northeast–southwest, 29.8 degrees east of north on the present main line through the Hail Street crossing. The 1913 Illinois Supreme Court opinion in City of Bushnell v. Chicago, Burlington & Quincy Railroad states the same layout: the right of way runs from northeast to southwest, East Main adjoins the east side, West Main adjoins the west side, and Hail is the cross street farthest north, with Hurst and then Barnes to the south. In the model the Burlington is one main track with a short siding by the depot and the elevator. The histories do not give the 1880 track count. The 1886 Sanborn map shows a wide railroad ground between the two Main streets, wide enough for more than a single rail.

The Toledo, Peoria & Warsaw was surveyed through Bushnell in 1867. The city and its citizens subscribed to the stock. By 1885 the county history calls that line part of the Wabash. It crosses the Burlington at about a right angle, so it runs the same direction as Hail Street, 1,680 feet southwest of the Hail crossing. That is just southwest of Davis Street. The crossing is the same one still used by the Keokuk Junction Railway, which inherited the route. A 1914 postcard, discussed on the Towns and Nature blog, places the T. P. & W. depot south of the Burlington station and just west of West Main. The model puts it there, with the long side beside that crossing track.

The Burlington depot in the model is the older wooden depot. The Northern Cross depot predated the Q. A newer CB&Q depot was built after 1900, and the old building was moved and reused as a freight house. So the 1880 station is the frame depot, not the later one. The Bushnell House was remembered as the hotel opposite the Q station.

People went down to the depot in the 1880s. J. M. Varner & Son kept a lunch room there. The little lunch building is shown, with a note that the 1885 history describes the business without pinning the year it opened.

Telegraph poles follow the Burlington. The line itself is certain for an 1880 main-line railroad. The pole spacing is inferred. Hitching posts, a watering trough, a town pump, and a few oil lamps are the ordinary street furniture of a town this size. The lamps are inferred. Wooden crossbucks mark the street crossings. The crossings are real. The exact sign design is inferred.

## Streets and sidewalks

The centennial history says the old board walks downtown were disappearing around 1900, when brick walks and the first pavement went in. A 1900 petition asked for pavement on German row (Hail Street from East Main to Crafford), on East Main from Ball's carriage shop to the Bank of Bushnell, and on West Main from Hail to Hurst. In 1880 the streets were still dirt, and the business streets had boardwalks. The model puts the walks on the store side of those streets.

## Buildings named in the records

These are `sourced` in the data file. The notes on each one say what is firm and what is only the lot.

- **Cole Building**, brick, corner of East Main and Hail. James Cole made the bricks in the 1860s. He was a merchant and, from 1878, a banker. By the mid-1880s he had closed the store to bank full time. The corner is from the centennial book.
- **Hendee Store**, brick, corner of Hurst and West Main, in the centennial book, which says it housed Hendee's store and the Chandler bank. The 1885 history says S. A. Hendee started on the east side of the railroad in 1860. Both are recorded. The model uses the corner the centennial names, and the notes say the 1860 site may have been across the tracks.
- **Hendee House**, built in the summer of 1871 by S. A. Hendee. In 1885 Boyington & Son kept it, and the history calls it the best hotel on the line from Galesburg to Quincy. It stood on West Main. The exact lot on that street is inferred. Later it was the Alexander.
- **Bushnell House**, another leading hotel, remembered as opposite the Q station. It is placed on East Main facing the depot. The side of the tracks is inferred from that phrase.
- **National Hotel**, built by the Negleys and later kept by A. Hess, on Crafford Street opposite the East Park.
- **St. Charles Hotel**, kept by L. H. Green on Hurst Street. The lot is inferred.
- **American House**, an early frame hotel on East Hurst. The lot is inferred.
- **Sorter House**, opposite the T. P. & W. station.
- **Farmers National Bank**, organized in 1871 out of the private bank of Chandler & Cummings, with Charles Wilson as president. It failed in 1885. A paving note puts the Bank of Bushnell on East Main. The Hail corner is inferred.
- **Zook & Johnson**, drugs, paints, oils, and wallpaper, from March 1876. They owned a brick store 20 by 60 feet and two stories. The size is used. Which bay on Main was theirs is not stated.
- **Masonic Hall.** T. J. Pickett Lodge No. 307 was chartered in 1859. By 1885 the lodge owned its building and met in a room 45 by 50 feet. The West Main door is inferred.
- **Hendee Elevator**, built in 1880, 42 by 66 feet, 27,000 bushels. A later photo shows an elevator across from the Hendee House. The siding location is inferred from that.
- **Depot Mill**, M. H. Hicks, by the railroad. **Excelsior Mill**, a steam flour mill built by Nevious Bros. It failed in the fall of 1884, so it was standing in 1880. The centennial book says it stood just west of the Depot Mill. The exact corners are inferred.
- **Bushnell Pump Company**, opened in 1872 by Nelson, LaTourette & Company. By 1885 it was a large frame works opposite the old Wabash depot, making wooden pumps, windmills, and croquet sets.
- **Roach Livery.** John Roach had kept a livery for about ten years by 1885, so a stable was here around 1880. The history puts it at West Main and First Street. No First Street survives on the plat, so the barn is shown at West Main near Barnes. The big 45-by-80 barn was built in 1885, just after this scene, and the model shows a slightly smaller stable.
- **Christian Church**, at the corner of Hurst and Dean, later the fire-house corner. Frame construction is inferred.
- **Furniture**, a little east of the Bushnell House. Miller & Krouser opened that trade in 1859. The neighboring door is inferred.
- **Stockton West** dealt in grain, wood, and coal. A yard and a small office are shown by the siding. The business is documented. The shed is inferred.

The Presbyterian and Methodist churches are in the model as congregations that existed, on inferred lots. The Presbyterian church stood near the Christian Church. A later Presbyterian building is on West Hurst. The graded school of 1875, which housed the high school, is the red-brick building at Jackson and Twyman, on the side of Jackson away from the tracks and on the Wells side of Twyman. Arthur Loomis, in the 1885 history, calls it a two-story brick school on a stone foundation whose basement stands about ten feet out of the ground, in the northwest part of town. A 2026 Bushnell school history puts that building at Jackson and Twyman. It burned in the 1890s. The buff-brick West Side School and the high-school plate in the 1907 encyclopedia are the replacements, so those fronts are not drawn. The first school, in 1856, was on Sperry Street, block 57, and was already gone by 1860.

## Fronts matched to a photograph

Buildings marked `facade.photoMatch` in the data file are the ones copied from a particular photograph. The info card says “Matched to a historic photo” for those, and only those. The card note gives the date. A street photograph can still set the rhythm of a whole row — windows, cornices, awnings, false fronts — without naming each door. Those doors stay stand-ins. `docs/photo-catalog.md` lists every picture gathered for this town, including the ones that are too late for 1880.

- **Cole Building**, East Main at Hail. The 1954 centennial prints a photograph captioned as the original Cole building. It is two stories of the soft red brick Cole burned in the 1860s, with four upstairs windows under segmental arches, a bracketed cornice, pilasters, and a cast-iron storefront whose door is at the Hail corner. The photograph itself is not dated. The same book later shows “the Cole Block in the early 1900s,” a taller front with round arches. That later front is not used. Cole had added banking in 1878, so the COLE sign fits 1880.
- **Hendee Store**, Hurst at West Main. The centennial photograph is captioned as the original Hendee building, housing Hendee’s store and the Chandler bank. It is two stories of red brick, three bays of segmental-arched upstairs windows, a bracketed cornice, and a cast-iron storefront with the door at the Hurst corner. The print sits next to the 1903 notes and is not dated. The 1885 history still says the 1860 store opened on the east side of the railroad, so that first counter may have been across the tracks.
- **Ball Bros.**, East Main at Gridley, the Gridley end of the 500 block. The centennial captions the photograph “The Ball Bros. corner in the 80’s.” The front follows that picture: light clapboard, a false front whose top is one triangle across the whole width, BALL BROS. painted in the gable, three flat upstairs windows, a double door between two shop windows, and a shed porch on posts. The 1885 history gives the works as two repositories, each 28 by 48 feet and two stories, with the blacksmith and wagon shop in the back of each. The corner repository is the one in the photograph. The second stands along Gridley, the same size, and is not a separate photograph. A 1907 biography says the main building then standing, 60 by 100 feet on Main Street, was erected in 1895. The brick front later used as a Packard dealership, and the building still standing at 140 East Gridley, are that later works. They are not drawn as the 1880 shop.
- **Hendee Elevator**, on the siding. The history gives the 1880 size, 42 by 66 feet. A centennial photograph taken looking southeast from the Alexander Hotel, in the 1902 entries, shows the wooden elevator, its gable, a cupola, and the driveway shed. The cupola is taken from that later picture of the same building. The exact footing is inferred from the view.

These were looked at and not copied onto a downtown door:

- The 1879 meat-market photograph (Frank, Philip, and Conrad Nessel) is a one-story false-front shop. The caption puts it on the alley, on what was then called Lincoln Avenue, where Adams Cleaners later stood. That street is not on the 1854 plat used here, so the shop is not placed.
- The 1898 view from the water tower shows the Kathcart Hotel, the Transfer Building, and two elevators. It is eighteen years late, and it is used only as a check that the downtown was a mix of brick blocks and false fronts. The water tower is not added. The Kathcart and the Transfer are not given 1880 fronts from that picture.
- A 1900 photograph captioned “West Main Street” shows a row of brick stores with cloth awnings and frame false fronts. It is not a named door. Awnings on the 500 block of West Main, except the boarding house that already has a porch, follow that picture. The info card does not call those doors photo-matched.
- A photograph captioned as a view west on Gridley from East Main, taken while Main Street was being paved (the pavement was finished in 1904), shows frame houses with porches. The Gridley houses follow that street. None of them is a named house, and none is marked photo-matched. The picture is later than 1880.
- The photograph captioned “Moving of the Bushnell Railway Depot” shows the wooden CB&Q depot on blocks. The county history says that older depot was moved when a newer station was built after 1900, and was reused as a freight house. The building in the photograph is the 1880 station, so the model uses its long clapboard body, deep-eaved gable, trackside bay, and platform, and puts it back between the two Main streets. The newer brick depot is not built.
- The 1914 T. P. & W. postcard is a one-story frame depot with a bay and a platform roof on posts. The railroad was open through Bushnell by 1880, and nothing found here says this depot was replaced before 1914, so the model uses that frame building. The postcard is thirty-four years later. A brick or twentieth-century station is not substituted for it.
- Hotel Alexander is the 1871 Hendee House under a later name. The undated photograph shows three brick stories, a bracketed cornice, segmental-arched windows, and a street porch. That front is used. The sign in the model still says Hendee House, which is the 1880 name.
- “West Main Street,” the 1918 view of East Hail, and a 1907 view of East Main (on the Digital Research Library of Illinois History Journal) are later than 1880. The 1886 Sanborn map already shows continuous storefronts on those blocks. The brick rhythm — narrow upstairs windows under segmental arches, a bracketed cornice, a cast-iron ground floor, a canvas awning — and the frame false fronts beside them follow those pictures. No single door in those pictures is marked photo-matched, because the pictures do not name the 1880 tenants.
- “North Crafford Street” is an undated residential view, front-gabled houses and porches. Houses facing Crafford take that front. They are not named houses.
- The birds-eye view and the view of trains show the wooden elevators. The Hendee Elevator already follows the about-1902 photograph. A column of shaft windows was added so it reads that way from the track. The water tower in the birds-eye view is the one the 1898 view also shows, and it is not added.
- The West School House plate in the 1907 encyclopedia, the poultry and egg plant, the fire department, the Hendee residence at 304 West Hurst, and 255 West Hail are catalogued and not placed as 1880 fronts. The plate is the school built after the 1875 building burned. The others are later than this scene or are a house rather than a downtown front.
- No photograph of the Bushnell House or the National Hotel was found, so those hotels stay as they were, apart from the same storefront rhythm the Main Street pictures give every unnamed brick front.

## The 500 block and Gridley Street

Bushnell ordered the streets marked and the houses numbered in April 1909. There was no “500” address in 1880. The modern numbers were placed on the 1854 streets with the Census Bureau’s address locator and the OpenStreetMap centerlines (2026):

- On East Main, 400 falls at Hurst, 500 at Hail, and 590 is still short of Gridley. The 500 block is Hail to Gridley.
- On West Main the same hundreds fall on the same cross streets. The 500 block is again Hail to Gridley.

East Main and West Main are still two streets, one on each side of the tracks. Both 500 blocks were already in the model as the store rows from Hail to Gridley. This pass names that block, puts Ball Bros. on the Gridley corner where the 1880s photograph shows them, and gives the West Main row the awnings from the 1900 street picture. The other shop names on the block are still typical trades, not documented proprietors.

Gridley Street itself had almost no fronts of its own. The houses there faced East Main, Crafford, and Dean, so a walk up Gridley looked at the sides of those buildings. Houses now face Gridley on both sides, east of the tracks and west of them, set on the curb the way the paving photograph shows the street. Where one of those houses landed on an older stand-in house, the older one was removed so the two would not occupy the same ground.

The Reformed Church is the one documented building on Gridley besides Ball Bros. It was organized in 1856, built in 1860 or 1861, and dedicated May 1, 1861, at the northwest corner of East Gridley and Crafford. No picture of it was found. The white frame church and steeple are inferred. “Northwest” is the corner toward Wells and toward the tracks.

## What was filled in

The January 1886 Sanborn map, six years after the scene, shows continuous brick and frame storefronts along both Main streets, with offices and halls upstairs, an alley behind, dwellings on the next streets, and a grain elevator in the railroad ground. Sanborn colors are red for brick and yellow for frame. The sheets are three, and the lettering is very small. This pass uses the map for that pattern, not for a door-by-door copy of every label.

The store names along the rows, other than the ones listed above, are typical trades: grocery, dry goods, hardware, millinery, boots, bakery, harness, a wagon shop, a saloon, a barber. They are stand-ins. German row, Hail Street from East Main to Crafford, is filled the same way. The 1900 paving petition is what calls that block German row.

Houses are one frame house on most platted lots off the business streets, with about one lot in four left empty. The 1886 map shows dwellings there. No particular house is a documented home. About three quarters are one story. Most have a porch. Paint colors are the ordinary white, cream, yellow, gray, barn red, and green.

There is no Sanborn map from 1880 itself. The Library of Congress has Bushnell sheets for January 1886 (3 sheets), August 1893 (4), May 1898 (4), March 1906 (5), and 1912. The 1886 set is the one used. The 1871 Andreas, Lyter & Co. atlas of McDonough County has a hand-colored plat of Bushnell that shows the Toledo, Peoria & Western. A copy of that sheet could not be opened online for this pass, so the plat geometry comes from the 1885 written survey plus the streets that are still on the ground.

The town's population in the 1880 census was 2,316, up from 2,003 in 1870.

## Street names, horses, and wagons

Every street in the town file keeps the name it already has. A painted board on a wooden post stands at the corners, which is how the name reads from the sidewalk. The same words are painted along the road. When the camera rises above the roofs, a second copy of each name stays a steady size so it can still be read. The names are Davis, Barnes, Hurst, Hail, Gridley, Wells, Sperry, Rile, Crafford, East Main, West Main, Dean, Jackson, and Washington. Nothing was renamed.

The horses and wagons are low-poly models made for this scene. No downloaded model is used. The horse is a light harness horse of about fifteen hands: barrel, neck, head, ears, mane, tail, four legs with hooves, and a collar and traces. The wagon is a late-nineteenth-century delivery wagon: a box bed, a seat, shafts, and spoked wheels, the rear pair larger than the front. Both are sized in the same feet as the buildings, so a horse’s back sits near the height of a person’s head and well below a storefront.

## Works used

- S. J. Clarke, *History of McDonough County, Illinois* (Springfield: D. W. Lusk, 1878). Library of Congress, [https://www.loc.gov/item/rc01002068/](https://www.loc.gov/item/rc01002068/).
- The 1885 history of McDonough County, Bushnell chapter, as transcribed by Illinois GenWeb: [https://mcdonough.illinoisgenweb.org/1885citybushnell.html](https://mcdonough.illinoisgenweb.org/1885citybushnell.html). This is the main written source for the plat, the hotels, the elevator, the mills, the bank, the pump works, the livery, the schools, and the lodge.
- *Bushnell, Illinois, centennial, 1854–1954*. Internet Archive text: [https://archive.org/stream/bushnellillinois00bush/bushnellillinois00bush_djvu.txt](https://archive.org/stream/bushnellillinois00bush/bushnellillinois00bush_djvu.txt). Corners, German row, the parks, the boardwalks, and the depot memories.
- Sanborn Map Company, *Bushnell, McDonough County, Illinois*, January 1886, 3 sheets. Library of Congress Geography and Map Division, [https://www.loc.gov/item/sanborn01757_001/](https://www.loc.gov/item/sanborn01757_001/). Public domain.
- Later Sanborn editions, not used as the 1880 picture: August 1893 ([sanborn01757_002](https://www.loc.gov/item/sanborn01757_002/)), May 1898 ([sanborn01757_003](https://www.loc.gov/item/sanborn01757_003/)), March 1906 ([sanborn01757_004](https://www.loc.gov/item/sanborn01757_004/)).
- Andreas, Lyter & Co., *Atlas of McDonough County, Illinois* (Davenport, 1871). The Bushnell plat is described by dealers as a street map showing the Toledo, Peoria & Western. The sheet itself was not viewed.
- Dennis DeBruler, “Bushnell, IL: BNSF/CB&Q and KJRY/TP&W/Northern Cross Depots,” Towns and Nature, November 2018, [http://towns-and-nature.blogspot.com/2018/11/bushnell-il-bnsfcb-and-kjrytp-cross.html](http://towns-and-nature.blogspot.com/2018/11/bushnell-il-bnsfcb-and-kjrytp-cross.html). The 1914 T. P. & W. depot postcard and the route of each line. Those depot pictures are after 1880 and were not used to restyle the wooden station.
- U.S. Census Bureau geocoder, Public AR Current benchmark, used in 2026 to see where 100 through 590 East Main and West Main fall, checked against OpenStreetMap centerlines of Hail, Hurst, Gridley, and the other cross streets. This is how the modern 500 block was set on the 1854 grid. The numbering ordinance is the April 1909 order in the centennial book.
- U.S. Census population for Bushnell: 2,003 in 1870 and 2,316 in 1880, as compiled in the historical population table for the city.
- OpenStreetMap street centerlines for Bushnell, measured in 2026, used only to confirm that the surviving grid still matches the 1854 spacing and the order of the streets.
- McDonough County Illinois Genealogical Society, Bushnell historic photographs, [https://www.mcdcgs.com/bushnell-historic-photos/](https://www.mcdcgs.com/bushnell-historic-photos/) and [https://www.mcdcgs.com/historic-photos/bushnell/](https://www.mcdcgs.com/historic-photos/bushnell/). The pictures are theirs. This project does not copy the image files into the app. Each one is listed in `docs/photo-catalog.md`.
- Neil Gale, “Bushnell, Illinois, a highly detailed look at a small settlement founded in 1854,” Digital Research Library of Illinois History Journal, 12 April 2022, [https://drloihjournal.blogspot.com/2022/04/bushnell-illinois-highly-detailed-look-from-1854.html](https://drloihjournal.blogspot.com/2022/04/bushnell-illinois-highly-detailed-look-from-1854.html). The page includes a photograph captioned East Main Street, 1907.
- CardCow Bushnell postcard index, [https://www.cardcow.com/viewall/71409/](https://www.cardcow.com/viewall/71409/). One card could be opened from here: the M. E. Church, postmarked 27 August 1909, [https://www.cardcow.com/514754/me-church-bushnell/](https://www.cardcow.com/514754/me-church-bushnell/).
- eBay shop search “bushnell il”, [https://www.ebay.com/shop/bushnell-il](https://www.ebay.com/shop/bushnell-il). Listings change. None were copied.
