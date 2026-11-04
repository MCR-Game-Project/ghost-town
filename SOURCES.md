# Sources

Ghost Town is a picture of downtown Bushnell, McDonough County, Illinois, about 1880. The streets and the railroad are taken from the old plat and from maps. Named buildings are taken from the county histories and the 1954 centennial book. Everything else is marked `inferred` in `public/data/bushnell-1880.json`.

Distances in the model are in feet. The origin is the middle of Hail Street on the centerline of the Chicago, Burlington & Quincy tracks. In the town file, positive x runs northeast along those tracks, and positive z is the side where West Main was first drawn. That side is geographic east once x points northeast, which had put East Main on the west side of the tracks and West Main on the east. The viewer mirrors that axis before drawing, so East Main is on the east side of the railroad and West Main is on the west. It then turns the whole plat so north in the scene is true north. The Burlington through downtown bears about 29.8 degrees east of north, measured on the present BNSF centerline, which is the same graded line.

## Street names

Hail and Hurst are the real names, spelled that way. Hail Street is named for John D. Hail of Macomb, one of the three men who laid the town out. The city still addresses City Hall at 138 East Hail Street. Hurst Street is the next street southwest of Hail. There is no Hale Street.

The other downtown streets used here, in the order they still stand, are:

- Southwest to northeast, crossing the tracks: Davis, Barnes, Hurst, Hail, Gridley, Wells, Twyman. Twyman is one block northeast of Wells, the same 420-foot module. Osborne continues farther northeast, outside this model.
- Northwest to southeast, parallel to the tracks: Washington, Jackson, Dean, West Main, the railroad ground, East Main, Crafford, Rile, Sperry, Cole. Cole Street is one block east of Sperry and is drawn. Jackson and Cole run the same direction and do not meet.

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

The Toledo, Peoria & Warsaw was surveyed through Bushnell in 1867. The city and its citizens subscribed to the stock. By 1885 the county history calls that line part of the Wabash. It crosses the Burlington at about a right angle, so it runs the same direction as Hail Street, 1,680 feet southwest of the Hail crossing. That is just southwest of Davis Street. The crossing is the same one still used by the Keokuk Junction Railway, which inherited the route. A 1914 postcard, discussed on the Towns and Nature blog, places one T. P. & W. depot south of the Burlington station and just west of West Main. Mark says the depot that still exists stands on the east side of the tracks. The building still standing is at East Main and Hurst, and the model puts it there. The crossing itself stays just southwest of Davis Street.

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
- **Farmers National Bank**, organized in 1871 out of the private bank of Chandler & Cummings, with Charles Wilson as president. It failed in 1885. Mark places it on the corner of East Main and Hail. North of it on East Main are a general store and a clothing store. East along Hail are the post office and then a furniture store beside the alley. The street front is the narrow three-window bank on the undated East Main postcard, door on the viewer's right. The signs on the four neighbors are the trades he named, not proprietors.
- **Zook & Johnson**, drugs, paints, oils, and wallpaper, from March 1876. They owned a brick store 20 by 60 feet and two stories. The size is used. Which bay on Main was theirs is not stated.
- **Masonic Hall.** T. J. Pickett Lodge No. 307 was chartered in 1859. By 1885 the lodge owned its building and met in a room 45 by 50 feet. The West Main door is inferred.
- **Hendee Elevator**, built in 1880, 42 by 66 feet, 27,000 bushels. Mark does not know the lot. The centennial says it stood on the railroad ground in front of the Hendee House, and the about-1902 photograph from that hotel shows its end. It is placed there, clear of the wooden depot. The crib, headhouse, cupola, and driveway opening are from that picture.
- **Depot Mill**, M. H. Hicks, by the railroad. **Excelsior Mill**, a steam flour mill built by Nevious Bros. It failed in the fall of 1884, so it was standing in 1880. The centennial book says it stood just west of the Depot Mill. The exact corners are inferred.
- **Bushnell Pump Company**, opened in 1872 by Nelson, LaTourette & Company. By 1885 it was a large frame works opposite the old Wabash depot, making wooden pumps, windmills, and croquet sets.
- **Roach Livery.** John Roach had kept a livery for about ten years by 1885, so a stable was here around 1880. The history puts it at West Main and First Street. No First Street survives on the plat, so the barn is shown at West Main near Barnes. The big 45-by-80 barn was built in 1885, just after this scene, and the model shows a slightly smaller stable.
- **Christian Church**, at the corner of Hurst and Dean, later the fire-house corner. Frame construction is inferred.
- **Furniture**, a little east of the Bushnell House. Miller & Krouser opened that trade in 1859. The neighboring door is inferred.
- **Stockton West** dealt in grain, wood, and coal. A yard and a small office are shown by the siding. The business is documented. The shed is inferred.

The Presbyterian and Methodist churches are in the model as congregations that existed, on inferred lots. The Presbyterian church stood near the Christian Church. A later Presbyterian building is on West Hurst. The German Methodist church is separate. The centennial book says that congregation finished its building in 1857 at the southwest corner of West Hail and Jackson, and that it still stands, so that church is drawn on the corner. The graded school of 1875 is the red-brick building at Cole and Hurst, described under Mark's placements below. Arthur Loomis, in the 1885 history, calls it a two-story brick school on a stone foundation whose basement stands about ten feet out of the ground, in the northwest part of town, with eight classrooms. The model keeps that stone base, the two classroom floors, and a cupola. The first school, in 1856, was on Sperry Street, block 57. In 1860 the school was transferred to Temperance hall.

## Fronts matched to a photograph

Buildings marked `facade.photoMatch` in the data file are the ones copied from a particular photograph. The info card says “Matched to a historic photo” for those, and only those. The card note gives the date. A street photograph can still set the rhythm of a whole row — windows, cornices, awnings, false fronts — without naming each door. Those doors stay stand-ins. `docs/photo-catalog.md` lists every picture gathered for this town, including the ones that are too late for 1880.

- **Cole Building**, East Main at Hail. The 1954 centennial prints a photograph captioned as the original Cole building. It is two stories of the soft red brick Cole burned in the 1860s, with four upstairs windows under segmental arches, a bracketed cornice, pilasters, and a cast-iron storefront whose door is at the Hail corner. The photograph itself is not dated. The same book later shows “the Cole Block in the early 1900s,” a taller front with round arches. That later front is not used. Cole had added banking in 1878, so the COLE sign fits 1880. The depth of the block behind that front is inferred.
- **Farmers National Bank**, East Main at Hail. Sourced front: the undated postcard of the East Main bank, three segmental upstairs windows, a bracket cornice, an iron storefront, and the door on the right as you face it. The width is narrowed to that three-bay front, with the Hail edge kept at the curb. The lot is inferred. The 1914 bank at 484 East Main is not this building. The dentist next door on the card is not given a name.
- **Hendee Store**, Hurst at West Main. The centennial photograph is captioned as the original Hendee building, housing Hendee’s store and the Chandler bank. It is two stories of red brick, three bays of segmental-arched upstairs windows, a bracketed cornice, and a cast-iron storefront with the door at the Hurst corner. The print sits next to the 1903 notes and is not dated. The 1885 history still says the 1860 store opened on the east side of the railroad, so that first counter may have been across the tracks.
- **Ball Bros.**, East Main at Gridley, the Gridley end of the 500 block. The centennial captions the photograph “The Ball Bros. corner in the 80’s.” The Main Street front follows that picture: light clapboard, a false front whose top is one triangle across the whole width, BALL BROS. painted in the gable, three flat upstairs windows, a double door between two shop windows, and a shed porch on posts. The 1885 history gives the works as two repositories, each 28 by 48 feet and two stories. Mark says the building still stands and that the north end looks as it did in 1880, and that the Gridley building was two-story brick. That Gridley block is drawn as red brick with segmental windows and an iron storefront. Packard-era photographs show later plate-glass display windows on the works, and those windows are not copied. A 1907 biography says the main building then standing, 60 by 100 feet on Main Street, was erected in 1895. That later enlargement is not substituted for the 1880 sizes.
- **Hendee Elevator**, on the railroad ground in front of the Hendee House. The history gives the 1880 size, 42 by 66 feet. A centennial photograph taken looking southeast from the Alexander Hotel, in the 1902 entries, shows the wooden elevator, its gable, a cupola, and the driveway shed. The model is a crib with a narrower headhouse, a cupola, shaft windows, and a driveway shed with a wagon opening. Mark does not know the lot. The centennial sentence and that view are why it stands in front of the hotel. The 1886 Sanborn shows an elevator in the railroad ground. A copy of the 1871 county atlas sheet could not be opened, so the footing is not taken from a drawn lot.

These were looked at and not copied onto a downtown door:

- The 1879 meat-market photograph (Frank, Philip, and Conrad Nessel) is a one-story false-front shop. The caption puts it on the alley, on what was then called Lincoln Avenue, where Adams Cleaners later stood. That street is not on the 1854 plat used here, so the shop is not placed.
- The 1898 view from the water tower shows the Kathcart Hotel, the Transfer Building, and two elevators. It is eighteen years late, and it is used only as a check that the downtown was a mix of brick blocks and false fronts. The water tower is not added. The Kathcart and the Transfer are not given 1880 fronts from that picture.
- A 1900 photograph captioned “West Main Street” shows a row of brick stores with cloth awnings and frame false fronts. It is not a named door. Awnings on the 500 block of West Main, except the boarding house that already has a porch, follow that picture. The info card does not call those doors photo-matched.
- A photograph captioned as a view west on Gridley from East Main, taken while Main Street was being paved (the pavement was finished in 1904), shows frame houses with porches. The Gridley houses follow that street. None of them is a named house, and none is marked photo-matched. The picture is later than 1880.
- The photograph captioned “Moving of the Bushnell Railway Depot” shows the wooden CB&Q depot on blocks. The county history says that older depot was moved when a newer station was built after 1900, and was reused as a freight house. The building in the photograph is the 1880 station, so the model uses its long clapboard body, deep bracketed eaves, a three-window bay on the track side, doors toward the ends, a platform, and a chimney at one end of the ridge, and puts it back between the two Main streets. The newer brick depot is not built. The print is small, so the window spacing is the photograph's rhythm, not a measured elevation.
- The 1914 T. P. & W. postcard is a smaller one-story frame depot, light clapboard, a gable, a bay, a platform roof on posts, and a chimney. Mark says the depot that still exists is on the east side of the tracks. The building still standing is the long gabled freight house at East Main and Hurst, and the model follows that building: cream clapboard, a gable, a row of windows and doors, a short platform, and a chimney. The 1914 bay and canopy are not on that surviving building, so they are not drawn. The McDonough County Voice, 3 February 2016, records the Bushnell Historical Society’s account that this is the only depot left of three.
- Hotel Alexander is the 1871 Hendee House under a later name. The undated photograph shows three brick stories, a bracketed cornice, seven bays of paired windows under segmental arches, and a porch along the sidewalk. That front is used. The sign in the model still says Hendee House, which is the 1880 name. The lot on West Main is inferred.
- “West Main Street,” the 1918 view of East Hail, and a 1907 view of East Main (on the Digital Research Library of Illinois History Journal) are later than 1880. The 1886 Sanborn map already shows continuous storefronts on those blocks. The brick rhythm follows those pictures: about one upstairs window to twelve feet of front, segmental arches, a bracketed cornice, an iron storefront with a transom and a bulkhead, and a canvas awning. Frame shops in the same rows use either a full-width triangular false front or a stepped parapet, which is the mix in the photographs. No single door in those pictures is marked photo-matched, because the pictures do not name the 1880 tenants. Trade words already on those doors are types, not proprietors copied from a sign.
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

The Reformed Church is the one documented building on Gridley besides Ball Bros. It was organized in 1856, built in 1860 or 1861, and dedicated May 1, 1861, at the northwest corner of East Gridley and Crafford. That corner is sourced. No picture of it was found. The white frame walls, the front gable, three tall side windows, the center door, and the modest steeple are the ordinary 1861 form, inferred. “Northwest” is the corner toward Wells and toward the tracks.

## What was filled in

The January 1886 Sanborn map, six years after the scene, shows continuous brick and frame storefronts along both Main streets, with offices and halls upstairs, an alley behind, dwellings on the next streets, and a grain elevator in the railroad ground. Sanborn colors are red for brick and yellow for frame. The sheets are three, and the lettering is very small. This pass uses the map for that pattern, not for a door-by-door copy of every label, except the East Main face of block 72, which is copied from the sheet.

The store names along the rows, other than the ones listed above, are typical trades: grocery, dry goods, hardware, millinery, boots, bakery, harness, a wagon shop, a saloon, a barber. They are stand-ins. German row, Hail Street from East Main to Crafford, is filled the same way. The 1900 paving petition is what calls that block German row.

Houses are one house on most platted lots off the business streets, with about one lot in four left empty. The January 1886 Sanborn map shows dwellings there. No particular house is a documented home. How those houses are drawn is set out under “Houses, about 1886” below.

There is no Sanborn map from 1880 itself. The Library of Congress has Bushnell sheets for January 1886 (3 sheets), August 1893 (4), May 1898 (4), March 1906 (5), and 1912. The 1886 set is the one used. The 1871 Andreas, Lyter & Co. atlas of McDonough County has a hand-colored plat of Bushnell that shows the Toledo, Peoria & Western. A copy of that sheet could not be opened online for this pass, so the plat geometry comes from the 1885 written survey plus the streets that are still on the ground.

The town's population in the 1880 census was 2,316, up from 2,003 in 1870.

## East Main at Hurst, block 72

Block 72 on the January 1886 map is the block between Hurst and Barnes on the south side of East Main. Sheet 2 of that set draws a row of shops along the East Main face. The Hurst corner is a one-story frame candy shop. West of it the sheet shows frame stores: two barber shops, a saloon with two stories on the street and one story behind, a restaurant, a shop marked only S., a bakery, a boarding house, a vacant two-story frame shop, a bowling alley, and a two-story meat market. One building in the row is brick. It is two stories, and the sheet divides it into a vacant store and a harness shop, with no openings in the wall between them. That harness shop is the only brick on the face. Footprints were measured on the sheet against the 360-foot block and rounded to the foot. Gaps the map leaves empty, including the open front toward Barnes, stay empty. A barber shop set back on Hurst, behind the candy shop, is not part of this East Main row and is not added.

The two-story brick Italianate that stands on the Hurst corner today is not this row. The August 1893 Sanborn already shows that later block, two stories of brick with an iron front. The 1880 scene keeps the frame row. The 1890 scene, below, draws the brick block.

The centennial book is the other source for this corner. John C. Goeppinger came to Bushnell in 1865 and kept a harness and hide business until 1910, and a later walk down this side of East Main puts his harness shop on the block. The sign still says Harness, which is all the 1886 map writes. The same walk mentions Charles Cole's candy store, but that memory is of the town after the brick corner was up, so his name is not put on the frame shop.

The rest of the block stays the East Park. Which of the two blocks the 1854 proprietors gave for parks is inferred. The 1886 map is what fills the East Main face.

## What Mark placed

Mark knows the town. These points are his, recorded in October 2026, and the buildings he placed are marked sourced.

- **Hendee Store.** He does not know whether the 1880 store was the Hurst and West Main corner or the earlier counter east of the tracks. The building stays at Hurst and West Main.
- **Farmers National Bank.** He places it on the corner of East Main and Hail. North of it, along East Main, a general store and then a clothing store. East along Hail, the post office, then a furniture store next to the alley. The four signs are those trades. A 2026 school history says a post office building stood on East Hurst around 1881. The Hail door is the one he named.
- **Ball Bros.** He says the building still stands and that the north end looks as it did in 1880. The Gridley building, which he calls the oldest one still standing, was two-story brick. The Main Street corner still follows the 1880s false-front photograph. The Gridley block is red brick, two stories. Open photographs of the present north wall were not found. Packard-era pictures show later display windows and were not copied.
- **Hendee Elevator.** He does not know where it stood. The centennial puts an elevator on the railroad ground in front of the Hendee House, and the about-1902 view from the hotel shows that end. It is moved there. The photo links in the catalog are the trackside elevator views and that hotel view. The 1886 Sanborn shows an elevator in the railroad ground. The 1871 atlas sheet could not be opened.
- **C. B. & Q. depot.** He does not know. It stays between the two Main streets.
- **T. P. & W. depot.** He says it still exists, on the east side of the tracks. It is moved to East Main and Hurst, which is where the surviving depot stands, and the long gable follows photographs of that building. The 1914 bay-window postcard is a different view, captioned west of West Main.
- **Hendee House.** He does not know the lot. It stays on West Main.
- **1875 high school.** He says Jackson and Cole, not Twyman, and that it had a cupola. It was the high school into the 1930s and the junior high in the 1970s. Jackson and Cole do not meet. Cole Street is drawn one block east of Sperry, and Twyman Street stays. The school that matches those dates is the East Side School at Cole and Hurst. An East Side High School postcard shows the cupola. The model stands on that corner. A 2026 school history also puts an 1875 building at Jackson and Twyman and says it burned in 1896.
- **Reformed Church, the Main and Hail and Hurst shops, and the Cole brick.** He cannot answer these from memory and will identify them from photographs. Those buildings are not changed. No photograph of the Reformed Church was found. The 1885 history calls it a good frame building on the corner of Church and Crafford streets. The Cole brick in the model is still the soft red of the centennial photograph. Which other doors were brick or frame, and which business names belong on them, are left as they were.

## Street names, horses, and wagons

Every street in the town file keeps the name it already has. A painted board on a wooden post stands at the corners, which is how the name reads from the sidewalk. The same words are painted along the road. When the camera rises above the roofs, a second copy of each name stays a steady size so it can still be read. The names are Davis, Barnes, Hurst, Hail, Gridley, Wells, Twyman, Sperry, Rile, Crafford, Cole, East Main, West Main, Dean, Jackson, and Washington. Twyman stays. Cole is the street east of Sperry.

The horses and wagons are low-poly models made for this scene. No downloaded model is used. The horse is a light harness horse of about fifteen hands: barrel, neck, head, ears, mane, tail, four legs with hooves, and a collar and traces. The wagon is a late-nineteenth-century delivery wagon: a box bed, a seat, shafts, and spoked wheels, the rear pair larger than the front. Both are sized in the same feet as the buildings, so a horse’s back sits near the height of a person’s head and well below a storefront.

## Houses, about 1886

The houses stay where they were. The lot, the center, and the facing are unchanged. What changed is the shape.

The January 1886 Sanborn map, three sheets, colors frame buildings yellow and brick buildings red or pink. On the blocks it draws, the dwellings are almost all frame. The number written on a house is the stories: 1, 1½, or 2. Many plans are an L or a T, a taller upright beside a lower wing. A small outbuilding, often crossed on the sheet, sits in the back yard. Brick dwellings are the exception. The sheets that were read closely for this pass are the house rows on blocks 72 (Crawford side), 80 (around the Baptist church and the Bushnell House label), 47 (Dean side), and the edges of 48. The map does not name the families.

The model follows that mix, not a traced outline of each lot. A front-gabled house, a gable-ell (upright and wing), a two-story I-house with a rear ell, a low-roofed Italianate with brackets, and a one-story side-gabled cottage are the forms. Six of the Italianates are brick, which is the small number the sheets allow. The rest are frame, with clapboard, a wood-shingle roof, a brick chimney, and tall sash, either 6-over-6 or 2-over-2, with shutters. Porches have turned posts. A picket fence, and a privy, shed, or well behind, are added where the yard allows, which is what the map’s back yards show. Gridley Street stays front-gabled, because the later paving photograph shows that street that way. Houses facing Crafford stay front-gabled for the same reason: the residential view of that street.

Paint is still the ordinary white, cream, yellow, gray, barn red, and green. The Picture menu is unchanged. It still only sets how sharp the picture is and how large the shadows are. The extra boards of a house are merged into the same few surfaces as the rest of the town.

The figures panel on the right is `public/data/bushnell-years.json`. The slider starts at 1854, the year the town was laid out, and then stops on the census years from 1860 through 2020. No 1860 population for the town was found. Bushnell received its city charter in 1869, and Bushnell Township was set off in 1866. There is no 1886 stop. The 1885 business list sits under 1880, and the January 1886 Sanborn labels sit under 1890. Each line keeps the year of its own source. The older file `public/data/bushnell-1886.json` is the same 1885 and 1886 material, kept so that list still has one place to read.

## The 1890 town

The year slider changes the picture as well as the figures. 1880 is the town in `public/data/bushnell-1880.json`. 1890, 1900, and 1910 are the Sanborn patches described below. 1854, 1860, and 1870 start from the 1880 town and take off every building a source does not yet place. The panel says “Town shown as of 1910” when a later census year is selected. 1854, 1860, 1870, 1880, 1890, 1900, and 1910 are the years the picture uses.

## The 1854 town

`public/data/bushnell-1854.json` keeps the streets. The 1885 history says William H. Rile laid the quarter into 48 blocks of 12 lots in 1854, with the two Main streets 70 feet wide and the other streets 60, parallel to the railroad, which was already graded and not yet finished. The two park blocks the proprietors gave stay. The Toledo, Peoria and Warsaw was not surveyed until 1867, so those tracks are not drawn. The house track beside the depot is not in the 1854 account, so it is not drawn either.

One building is added. Hiram and Daniel Markham opened a slab store in the summer of 1854. The centennial book puts the first house, and that store, on the northeast corner of East Main and Wells. The 1885 history says the slab store stood on the site of the later normal college, and that the town then held only a couple of shanties. The normal-college lot was not found on this plat, so the store follows the centennial corner. The oil lamps, hitching posts, boardwalks, wagons, and the bandstand are not dated to 1854, so they are not drawn in 1854, 1860, or 1870. Nothing else is drawn. John Crawford’s hotel was finished by John D. Hail in the summer of 1855, so it is not in this year. The four houses of Hiram Conover, John Beach, William Ervin, and William Vickers are dated early in 1855 by the centennial book, and no lots were given.

## The 1860 town

`public/data/bushnell-1860.json` again clears the 1880 buildings, then puts back only what is dated by 1860.

- The American House, the frame hotel on East Hurst. The centennial book says the first hotel was John D. Hail’s in 1855 and was called the American House. The lot along that street is the one already used. The exact lot was not named.
- The German Methodist church, finished in 1857 at the southwest corner of West Hail and Jackson.
- The store Hiram Markham built on the later Ball and Son corner, East Main at Gridley. Negley and Angle opened in it in April 1856. The 1860 tenant was not named, so the sign does not invent one.

The first schoolhouse, 1856, stood on Sperry Street, block 57. In 1860 the school moved to Temperance hall. That hall was not located, so it is not drawn. The Reformed church was dedicated May 1, 1861, so it is not in this year. S. A. Hendee’s 1860 store was on the east side of the railroad, at a door the history does not name. James Cole’s 1855 frame store, 16 by 48 feet, stood on the later Seibert site and was afterward moved to New Philadelphia. The year it left was not found, so it is not drawn. The history’s count of 125 buildings by the end of 1856 has no lots, so those lots stay empty. No data found for a 1860 population.

## The 1870 town

`public/data/bushnell-1870.json` keeps the 1860 buildings and adds the ones dated before 1870.

- The Reformed church, dedicated in 1861, at the northwest corner of East Gridley and Crafford.
- James Cole’s brick corner at East Main and Hail. The bricks were made in the 1860s. The exact year was not found, which is why it is not in the 1860 picture.
- The Nevius Brothers flour mill of 1866, taken to be the Excelsior mill the 1885 history credits to Nevious Bros. It uses the lot already given to that mill. The Depot Mill has no date, so it is not drawn.

Not drawn, because they come later: the Hendee House and the Farmers National Bank, both 1871; the pump works, 1872; the graded-school building of 1875; Zook and Johnson, 1876; the Hendee elevator, 1880. The Toledo, Peoria and Warsaw was surveyed in 1867. No opening date was found, so its tracks and depot are not drawn in 1870. No data found for the doors of West and Kaiser, Lemuel Aller, or Aller, Seibert and Co.

The change that was copied door by door is the East Main face of block 72, between Hurst and Barnes. On the August 1893 sheet the Hurst corner is a two-story brick block with an iron front. A pediment and a finial sit on the corner room. The rooms read on that block, from Hurst west, are a market, dry goods, boots and shoes, clothing, and a restaurant. West of the brick are frame shops: a one-story store marked S., a two-story harness shop, a two-story bakery, and a shop for china, lamps, and wallpaper. Farther west is a two-story brick agricultural-implement store, then an open stretch, then a two-story frame building at Barnes divided into groceries, a vacant room, and beverages. The January 1886 candy shop, barber shops, saloon, bowling alley, and meat market are not on this front. The lettering is small. The corner room’s word is the least sure of the row; the others are the usual Sanborn abbreviations.

The Crawford side of block 72 already has frame dwellings on the January 1886 sheet, so those houses are in the 1880 town, not added in 1890. The August 1893 sheet still shows them. The August 1893 map labels the West Main hotel Alexander, so the 1890 sign says Alexander. The 1880 sign still says Hendee House.

The same 1893 sheets, read past block 72, add these and no others. Sheet 2 puts Excelsior Mills on the Dean side of the block between Davis and Barnes, so that mill moves there. The railroad inset labels Angel Bros., Bushnell Roller Mills, and that name goes on the mill already standing by the tracks. Sheet 3 labels Mack & M. Pinckley's lumber yard on the railroad ground. Sheet 4 labels Vanderveer & Logsdon's electric light works and the city water works in the north works district with the pump company, and a brick plant, N.E.F. Manufacturing Co., west of Davis. Ludwig Street is the next cross street southwest of Davis on sheet 4. It is drawn one 420-foot module beyond Davis, the plat spacing, from the railroad ground down toward Crafford, with three frame houses and no family names. A cigar factory is labeled on the Hurst side of block 72. Blocks whose doors could not be read are left as they were.

## The 1900 town

The May 1898 Sanborn, four sheets, is the nearest map to 1900. It is `public/data/bushnell-1900.json`, applied on top of the 1890 town. On sheet 2 the Dean-side mill is labeled H. H. Obenhauer & Co. The Hurst rooms of the brick block read, from the corner west: Photo, groceries, vacant, lunch, and saloon. Other rooms on that sheet were not clear enough to rename, so they keep the 1893 names. No new street is added. The 1898 index names Osborne Street. A detached inset draws it beside the west-side school, and the old plat note puts it northeast of Twyman. Those two places were not reconciled, so Osborne is not drawn.

## The 1910 town

The March 1906 Sanborn, five sheets, is the nearer map before 1910. The February 1912 Sanborn, eight sheets, is the check after it. Both are applied from `public/data/bushnell-1910.json` on top of 1900. A line that comes from 1912 says so.

On block 72 the Hurst rooms of the brick block read, from the corner west: jewelry and photographs, dry goods, bowling, restaurant, and saloon. The harness shop is brick. The electric plant is labeled Bushnell Electric Light & Power Co. The brick works west of the tracks are labeled Bushnell Tank & Fence Works (the 1912 sheet says Bushnell Tank Works). The trackside lumber yard is J. C. Simpson & Co. Block 81 labels J. W. Roach's livery. Charles Street is the street along the west side of the pump company on the 1906 sheet, drawn there and not across the whole plat. Two frame houses stand on its east side, with no family names. The 1912 sheet adds Martin Schulze's poultry and ice house near East Main and East Davis.

The 1912 index names many more streets, including lettered avenues and Franklin, Grant, Lincoln, Walnut, and Water. Their corners were not measured on this plat, so they are not drawn. No data found for those lines.

## Houses from one year to the next

The minus and plus buttons beside the year slider step to the previous and next year on the slider. The first year has no earlier step. The last year has no later step. The slider itself is unchanged.

Houses are compared only where a source names a lot.

Before the January 1886 map, the only houses with a place in the records are these. 1854 and 1860 both show the Markham house at the northeast corner of East Main and Wells. No source says another house was built on a named lot by 1860, and no source says that house was down, so nothing is added or removed between those two years. The four houses of 1855, Conover, Beach, Ervin, and Vickers, have no lots. No data found for them. In 1870 the centennial book places three more: J. C. Vail at Hail and Jackson, Mart F. West at Hail and Dean, and D. M. Wyckoff at the north end of Rile. S. R. Hendee’s 1870 house is only “on Hurst Street,” and Dr. Beadles’s is only “on Jackson Street.” Those two lots were not found, so the houses are not drawn.

The January 1886 Sanborn is what fills the 1880 town with dwellings. On the sheets that were read lot by lot, block 72’s Crawford side has five frame dwellings, and block 80 has the Baptist church, dwellings along Crawford, and a one-story dwelling at the Davis end of East Main. The rest of the houses in that town are the earlier stand-ins for blocks the sheets show as built up, and they are still marked inferred. They are not a traced copy of every lot.

From 1886 to the August 1893 sheet, those block 72 and block 80 dwellings are still there. Three new frame houses are drawn on Ludwig Street, which that sheet names and the 1886 sheets do not. No dwelling on the blocks read here was missing in 1893, so none of those is removed.

From the August 1893 sheet to the May 1898 sheet, the one-story house at the Davis end of block 80 is replaced by a two-story house. A dwelling is added on lot 2 of block 72, Crawford side, where the 1893 sheet shows the cigar factory and no house. 

From the May 1898 sheet to the March 1906 sheet, that lot 2 house is replaced by the two-story lodgings the 1906 sheet labels. The February 1912 sheet still shows dwellings on this side of the block. Two houses on Charles Street, already taken from the 1906 sheet, come in with 1910. The block-by-block checklist is `docs/block-audit.md`. Blocks not finished there are left as they were. No data found for a door-by-door list of those blocks.

A building taken from a Sanborn sheet carries `sourceMap` with that sheet’s date. The card in the corner prints it.

## Figures by census year

The panel has three dropdowns for the selected census year: Census, School, and Businesses. A year with nothing found in that dropdown says “No data found.”

Census. The city population is the U.S. decennial census for Bushnell, McDonough County. 2,003 in 1870 and 2,316 in 1880 were already used here. 2,314 in 1890 is the same census series, and it is the number a Rand McNally atlas printed in 1895. 2,490 in 1900 is also printed in the 1907 Historical Encyclopedia of Illinois. The later decades, through 2,718 in 2020, are that same census series as compiled in the historical population table for the city. A 1920 census bulletin page for Illinois places was opened, but the print was too broken to copy a digit from, so the 1920 count was not taken from that page.

School. No enrollment total for a census year was found. What is shown is dated and labeled. Arthur Loomis, in the 1885 history, says a graded school began in 1868 under Mr. Hyde, and he describes the 1876 building: eight classrooms, a superintendent’s room, a two-room primary building, John P. Yoder superintendent since 1880, and about $600 a month for teachers, fuel, and the like. The centennial book says the first high-school class, in 1878, was six graduates; the course was three years sometime before 1889; the 1875–76 building burned in 1896; in October 1900 Superintendent W. H. Miller was told that high-school students would be admitted to the University of Illinois without examination; and the East Side school opened in the winter of 1904. Western Normal College’s 1881 opening numbers, about 15, then about 20, then about 300 different students in that first year, are labeled 1881. The 1907 encyclopedia says the town had graded public and high schools, and gives no count. Other census years have no school record in the sources read for this panel.

Businesses. The 1880 stop lists the firms the 1885 county history describes as then open. The 1890 stop lists the trades the January 1886 Sanborn map prints on the East Main face of block 72, without proprietors, plus the *Bushnell Record* (1882–1940) and the *McDonough Democrat* (Bushnell, from 1884). Those two papers are listed again through 1940, which is as far as the Record’s run is dated. The 1910 stop also lists the trades in the 1907 Historical Encyclopedia of Illinois: wooden pumps, flour, agricultural implements, wagons and carriages, tank and fence work, rural mailboxes, mattresses, brick, egg and poultry packing, grain elevators, three banks, water works, electric lights, and a public library. That paragraph names no owners. The August 1893, May 1898, March 1906, and 1912 Sanborn sheets were not read door by door for this panel, so their labels are not copied. Where a census year has no shop list, the dropdown says no data was found. The Illinois gazetteers that could be opened are still only 1858–59 and 1864–65.

## Figures for 1886

No census was taken in 1886. The city of Bushnell counted 2,316 people in the 1880 census and 2,314 in the 1890 census. The 1890 number is also what a Rand McNally atlas printed in 1895. The panel says both, and it says there is no 1886 count.

No count of children enrolled in 1886 was found. The Illinois superintendent’s reports for those years could not be opened. Arthur Loomis, in the 1885 county history, describes the public school: eight classrooms (rooms 3 through 10), a superintendent’s room, and a smaller primary building of two rooms. John P. Yoder had been superintendent since 1880. Teachers, fuel, and the like cost about $600 a month. He does not say how many children sat in the rooms. The centennial book describes the same 1875–76 building as eight classrooms and four basement rooms, and says the first high-school class, in 1878, was six graduates. That is not an 1886 enrollment.

The Western Normal College opened July 20, 1881, with about fifteen pupils, about twenty before the term ended, and about 300 different students before that first year closed. The centennial book says J. A. Lyons was principal for a while, the school closed, and it was revived in 1888. The January 1886 Sanborn map still labels the building. No 1886 enrollment for it was found. Those 1881 numbers are labeled 1881.

The businesses are the ones the 1885 history describes as then open, plus the trades the January 1886 map prints on the East Main face of block 72, where it does not print a proprietor. The Illinois State Gazetteer editions that could be opened are 1858–59 and 1864–65. No 1884–1886 gazetteer could be read, so those early lists were not used. The Farmers’ National Bank had closed in 1885 and is not shown as open. Newspapers: the Bushnell Record (1882–1940) and the McDonough Democrat (Bushnell, from 1884) were both in print. A proprietor for 1886 was not copied from a directory.

## Works used

- S. J. Clarke, *History of McDonough County, Illinois* (Springfield: D. W. Lusk, 1878). Library of Congress, [https://www.loc.gov/item/rc01002068/](https://www.loc.gov/item/rc01002068/).
- The 1885 history of McDonough County, Bushnell chapter, as transcribed by Illinois GenWeb: [https://mcdonough.illinoisgenweb.org/1885citybushnell.html](https://mcdonough.illinoisgenweb.org/1885citybushnell.html). This is the main written source for the plat, the hotels, the elevator, the mills, the bank, the pump works, the livery, the schools, and the lodge.
- *Bushnell, Illinois, centennial, 1854–1954*. Internet Archive text: [https://archive.org/stream/bushnellillinois00bush/bushnellillinois00bush_djvu.txt](https://archive.org/stream/bushnellillinois00bush/bushnellillinois00bush_djvu.txt). Corners, German row, the parks, the boardwalks, and the depot memories.
- Sanborn Map Company, *Bushnell, McDonough County, Illinois*, January 1886, 3 sheets. Library of Congress Geography and Map Division, [https://www.loc.gov/item/sanborn01757_001/](https://www.loc.gov/item/sanborn01757_001/). Public domain.
- Sanborn Map Company, *Bushnell*, August 1893, 4 sheets, [https://www.loc.gov/item/sanborn01757_002/](https://www.loc.gov/item/sanborn01757_002/). Map for the 1890 town.
- Sanborn Map Company, *Bushnell*, May 1898, 4 sheets, [https://www.loc.gov/item/sanborn01757_003/](https://www.loc.gov/item/sanborn01757_003/). Map for the 1900 town.
- Sanborn Map Company, *Bushnell*, March 1906, 5 sheets, [https://www.loc.gov/item/sanborn01757_004/](https://www.loc.gov/item/sanborn01757_004/), and February 1912, 8 sheets, [https://www.loc.gov/item/sanborn01757_005/](https://www.loc.gov/item/sanborn01757_005/). Maps for the 1910 town. A 1912 name is labeled 1912.
- Andreas, Lyter & Co., *Atlas of McDonough County, Illinois* (Davenport, 1871). The Bushnell plat is described by dealers as a street map showing the Toledo, Peoria & Western. The sheet itself was not viewed.
- Dennis DeBruler, “Bushnell, IL: BNSF/CB&Q and KJRY/TP&W/Northern Cross Depots,” Towns and Nature, November 2018, [http://towns-and-nature.blogspot.com/2018/11/bushnell-il-bnsfcb-and-kjrytp-cross.html](http://towns-and-nature.blogspot.com/2018/11/bushnell-il-bnsfcb-and-kjrytp-cross.html). The 1914 T. P. & W. depot postcard and the route of each line. Those depot pictures are after 1880 and were not used to restyle the wooden station.
- U.S. Census Bureau geocoder, Public AR Current benchmark, used in 2026 to see where 100 through 590 East Main and West Main fall, checked against OpenStreetMap centerlines of Hail, Hurst, Gridley, and the other cross streets. This is how the modern 500 block was set on the 1854 grid. The numbering ordinance is the April 1909 order in the centennial book.
- U.S. decennial census for the city of Bushnell, McDonough County, Illinois: 2,003 in 1870, 2,316 in 1880, and 2,314 in 1890, as compiled in the historical population table for the city. No census was taken in 1886. The 1890 figure is the one a Rand McNally atlas printed for Bushnell in 1895, noted at [https://roadsidethoughts.com/il/bushnell-xx-mcdonough-1890s.htm](https://roadsidethoughts.com/il/bushnell-xx-mcdonough-1890s.htm).
- Illinois State Gazetteer and Business Directory, 1858–59 (George W. Hawes) and 1864–65 (J. C. W. Bailey), both on the Internet Archive. No edition for 1884–1886 could be opened, so those early lists were not used for the 1886 panel.
- *Bushnell Record*, published at Bushnell 1882–1940, Illinois Newspaper Project, University of Illinois. *McDonough Democrat* (Bushnell, Ill.), begun 1884, Library of Congress Chronicling America, [https://www.loc.gov/item/sn93055682/](https://www.loc.gov/item/sn93055682/).
- The year slider in the figures panel reads `public/data/bushnell-years.json`. The 1885 and 1886 lists are also kept in `public/data/bushnell-1886.json`.
- Newton Bateman and Paul Selby, eds., *Historical Encyclopedia of Illinois* (Chicago: Munsell Publishing Co., 1907). The Bushnell paragraph gives the 1900 population as 2,490 and lists trades without naming the owners. The copy read was the transcription attached to the St. Clair County volume on a genealogy site; the paragraph is the Illinois encyclopedia entry.
- OpenStreetMap street centerlines for Bushnell, measured in 2026, used only to confirm that the surviving grid still matches the 1854 spacing and the order of the streets.
- McDonough County Illinois Genealogical Society, Bushnell historic photographs, [https://www.mcdcgs.com/bushnell-historic-photos/](https://www.mcdcgs.com/bushnell-historic-photos/) and [https://www.mcdcgs.com/historic-photos/bushnell/](https://www.mcdcgs.com/historic-photos/bushnell/). The pictures are theirs. This project does not copy the image files into the app. Each one is listed in `docs/photo-catalog.md`.
- Neil Gale, “Bushnell, Illinois, a highly detailed look at a small settlement founded in 1854,” Digital Research Library of Illinois History Journal, 12 April 2022, [https://drloihjournal.blogspot.com/2022/04/bushnell-illinois-highly-detailed-look-from-1854.html](https://drloihjournal.blogspot.com/2022/04/bushnell-illinois-highly-detailed-look-from-1854.html). The page includes a photograph captioned East Main Street, 1907.
- CardCow Bushnell postcard index, [https://www.cardcow.com/viewall/71409/](https://www.cardcow.com/viewall/71409/). One card could be opened from here: the M. E. Church, postmarked 27 August 1909, [https://www.cardcow.com/514754/me-church-bushnell/](https://www.cardcow.com/514754/me-church-bushnell/).
- eBay shop search “bushnell il”, [https://www.ebay.com/shop/bushnell-il](https://www.ebay.com/shop/bushnell-il). Listings change. None were copied.
