#!/usr/bin/env python3
"""Regenerate public/data/bushnell-1880.json.

The app reads the JSON, not this script. Running this file overwrites
hand edits in the JSON. Dimensions follow the 1854 plat: 360-foot blocks,
60-foot streets, 70-foot East Main and West Main, and a railroad reserve
between those two streets.
"""

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "bushnell-1880.json"

# Feet. +x is northeast along the CB&Q (toward Gridley and Galesburg).
# +z is northwest, the west side of town (West Main, Dean).
# Hail Street is x = 0. The CB&Q centerline is z = 0.
CROSS = [
    ("Davis", -1260),
    ("Barnes", -840),
    ("Hurst", -420),
    ("Hail", 0),
    ("Gridley", 420),
    ("Wells", 840),
]
PARALLEL = [
    ("Sperry", -1421, 60),
    ("Rile", -1001, 60),
    ("Crafford", -581, 60),
    ("East Main", -156, 70),
    ("West Main", 156, 70),
    ("Dean", 581, 60),
    ("Jackson", 1001, 60),
    ("Washington", 1421, 60),
]
CROSS_W = 60
BLOCK = 360

rng = random.Random(1880)


def half(name):
    for n, at, w in PARALLEL:
        if n == name:
            return w / 2
    return CROSS_W / 2


def cross_at(name):
    return dict(CROSS)[name]


def para_at(name):
    return {n: at for n, at, _w in PARALLEL}[name]


def block_xz(cross_a, cross_b, para_a, para_b):
    """Inclusive property box between two cross streets and two parallel streets.
    cross_a is the more negative (southwest) street."""
    ax, bx = cross_at(cross_a), cross_at(cross_b)
    az, bz = para_at(para_a), para_at(para_b)
    x0, x1 = (ax + CROSS_W / 2, bx - CROSS_W / 2) if ax < bx else (bx + CROSS_W / 2, ax - CROSS_W / 2)
    if az < bz:
        z0, z1 = az + half(para_a), bz - half(para_b)
    else:
        z0, z1 = bz + half(para_b), az - half(para_a)
    return x0, x1, z0, z1


buildings = []
lots = []
blocks = []
boardwalks = []
props = []
trees = []


def add_building(**kwargs):
    kwargs.setdefault("porch", False)
    kwargs.setdefault("party", [])
    kwargs.setdefault("sign", kwargs.get("name", "").upper())
    kwargs.setdefault("brick", "red")
    kwargs.setdefault("paint", "cream")
    kwargs.setdefault("year", "")
    buildings.append(kwargs)
    return kwargs


def row_facing_z(x_start, x_end, front_z, facing, specs):
    """Place a party-wall row. x increases from the start corner toward x_end."""
    direction = 1 if x_end > x_start else -1
    widths = [s["width"] for s in specs]
    span = abs(x_end - x_start)
    if abs(sum(widths) - span) > 0.1:
        raise SystemExit(f"Row widths {sum(widths)} != span {span} at z={front_z}")
    x = x_start
    n = len(specs)
    for i, spec in enumerate(specs):
        w = spec["width"]
        d = spec["depth"]
        cx = x + direction * w / 2
        # Front is the face toward the street.
        if facing == "+z":
            cz = front_z - d / 2
        elif facing == "-z":
            cz = front_z + d / 2
        else:
            raise SystemExit(facing)
        party = []
        # Local +X points the same way as world +X when facing ±z and direction is +1.
        # When the row walks toward -x, local +X still points +x, so the "next" building
        # is on local -X.
        next_on_positive = direction > 0
        if i > 0:
            party.append("left" if next_on_positive else "right")
        if i < n - 1:
            party.append("right" if next_on_positive else "left")
        spec = dict(spec)
        spec.update(
            x=round(cx, 2),
            z=round(cz, 2),
            facing=facing,
            party=party,
        )
        add_building(**spec)
        x += direction * w


def place_facing_x(front_x, facing, z_center, width, depth, **spec):
    if facing == "+x":
        cx = front_x - depth / 2
    elif facing == "-x":
        cx = front_x + depth / 2
    else:
        raise SystemExit(facing)
    spec.update(
        x=round(cx, 2),
        z=round(z_center, 2),
        width=width,
        depth=depth,
        facing=facing,
    )
    return add_building(**spec)


# ---------------------------------------------------------------------------
# Blocks and platted lots
# ---------------------------------------------------------------------------

CROSS_NAMES = [n for n, _ in CROSS]
PARA_NAMES = [n for n, _, _ in PARALLEL]


def block_use(ca, cb, pa, pb):
    pair = {ca, cb}
    paras = {pa, pb}
    if pair == {"Barnes", "Hurst"} and paras == {"East Main", "Crafford"}:
        return "park", "East Park"
    if pair == {"Barnes", "Hurst"} and paras == {"West Main", "Dean"}:
        return "park", "West Park"
    commercial_pairs = [{"Hurst", "Hail"}, {"Hail", "Gridley"}]
    main_edges = [{"East Main", "Crafford"}, {"West Main", "Dean"}]
    if pair in commercial_pairs and paras in main_edges:
        return "commercial", "Business block"
    if pair == {"Barnes", "Hurst"} and ("East Main" in paras or "West Main" in paras):
        return "commercial", "Lower Main"
    if pair == {"Davis", "Barnes"} and ("East Main" in paras or "West Main" in paras):
        return "industrial", "Mill and depot grounds"
    return "residential", "Houses"


for i in range(len(CROSS_NAMES) - 1):
    for j in range(len(PARA_NAMES) - 1):
        # Skip the railroad reserve between East Main and West Main.
        if {PARA_NAMES[j], PARA_NAMES[j + 1]} == {"East Main", "West Main"}:
            continue
        ca, cb = CROSS_NAMES[i], CROSS_NAMES[i + 1]
        pa, pb = PARA_NAMES[j], PARA_NAMES[j + 1]
        x0, x1, z0, z1 = block_xz(ca, cb, pa, pb)
        use, label = block_use(ca, cb, pa, pb)
        bid = f"{ca.lower()}-{cb.lower()}__{pa.lower().replace(' ', '-')}-{pb.lower().replace(' ', '-')}"
        blocks.append(
            {
                "id": bid,
                "name": f"{label} between {ca} and {cb}, {pa} and {pb}",
                "crossStreets": [ca, cb],
                "parallelStreets": [pa, pb],
                "x0": round(x0, 2),
                "x1": round(x1, 2),
                "z0": round(z0, 2),
                "z1": round(z1, 2),
                "use": use,
                "confidence": "sourced" if use == "park" else "inferred",
                "notes": (
                    "One of the two full blocks the 1854 proprietors gave the town for a park, "
                    "one on each side of the railroad. The exact block is inferred: the business "
                    "frontage on Hail was not the park, and the National Hotel stood on Crafford "
                    "opposite the East Park."
                    if use == "park"
                    else "Block outline follows the 1854 plat. The use is inferred from the 1886 Sanborn pattern and the county histories."
                ),
            }
        )
        # Twelve platted lots: six facing each parallel street, 60-foot frontage.
        # An alley is left between the two tiers. 6 * 60 = 360.
        alley = 60
        depth = (abs(z1 - z0) - alley) / 2
        for side, front_street, z_front, z_dir in (
            ("low", pa if para_at(pa) < para_at(pb) else pb, z0, 1),
            ("high", pb if para_at(pb) > para_at(pa) else pa, z1, -1),
        ):
            for n in range(6):
                lx0 = x0 + n * 60
                lots.append(
                    {
                        "id": f"{bid}-lot-{side}-{n + 1}",
                        "block": bid,
                        "number": n + 1 if side == "low" else n + 7,
                        "frontStreet": front_street,
                        "x": round(lx0 + 30, 2),
                        "z": round(z_front + z_dir * depth / 2, 2),
                        "width": 60,
                        "depth": round(depth, 2),
                        "use": use,
                        "confidence": "inferred",
                        "notes": "1854 plat: 12 lots to a 360-foot block. Six 60-foot lots are shown facing each parallel street, with a mid-block alley. That lot split is the usual one and is inferred, not copied from a lot map.",
                    }
                )


# ---------------------------------------------------------------------------
# Named and row buildings
# ---------------------------------------------------------------------------

NOTE_ROW = (
    "The January 1886 Sanborn map shows a continuous row of brick and frame stores "
    "along this part of Main Street. This shop stands in for one of those storefronts. "
    "Its name is a typical trade, not a documented proprietor."
)
NOTE_HOUSE = (
    "The 1886 Sanborn map shows dwellings on the blocks off the business streets. "
    "This house is a stand-in of the right size and material, not a documented home."
)


def store(name, use, kind, width, depth, confidence="inferred", notes=NOTE_ROW, sign=None, **extra):
    material = "brick" if kind in ("brick-store", "hotel") else "frame"
    item = dict(
        name=name,
        kind=kind,
        use=use,
        material=material,
        stories=extra.pop("stories", 2),
        width=width,
        depth=depth,
        confidence=confidence,
        notes=notes,
        sign=sign or name,
        porch=extra.pop("porch", kind == "hotel"),
    )
    item.update(extra)
    return item


# East Main, Hurst to Hail. Front at the east curb, buildings face the tracks (+z).
# Widths sum to 360. Order runs from Hurst (southwest) to Hail.
em_front = para_at("East Main") - 35  # -191
row_facing_z(
    -390,
    -30,
    em_front,
    "+z",
    [
        store("Grocery", "grocery", "frame-store", 28, 52, paint="cream"),
        store("Dry Goods", "dry goods", "brick-store", 36, 68, brick="dark"),
        store("Millinery", "millinery", "frame-store", 24, 48, paint="green"),
        store("Hardware", "hardware", "brick-store", 40, 70, brick="red"),
        store("Boots & Shoes", "boots and shoes", "brick-store", 32, 60, brick="soft"),
        store("Bakery", "bakery", "brick-store", 22, 50),
        store("Barber", "barber", "frame-store", 24, 44, paint="white"),
        store(
            "Zook & Johnson",
            "drugs, paints, and wallpaper",
            "brick-store",
            20,
            60,
            confidence="sourced",
            year="1876",
            brick="red",
            sign="ZOOK & JOHNSON",
            notes="Zook & Johnson opened in March 1876 in a brick store they owned, 20 by 60 feet and two stories. Which door on Main was theirs is not stated, so this bay uses the documented size inside the East Main row.",
        ),
        store(
            "Furniture",
            "furniture",
            "brick-store",
            36,
            64,
            notes="Miller & Krouser opened a furniture store in 1859 a little east of the Bushnell House. Later firms followed. The spot beside the hotel is inferred from that phrase.",
        ),
        store(
            "Bushnell House",
            "hotel",
            "hotel",
            50,
            78,
            stories=3,
            porch=True,
            confidence="sourced",
            sign="BUSHNELL HOUSE",
            brick="dark",
            notes="A leading hotel by 1885, described as opposite the Chicago, Burlington & Quincy station. Placed on East Main facing the depot grounds. The exact lot is inferred.",
        ),
        store(
            "Cole Building",
            "bank and general store",
            "brick-store",
            48,
            74,
            confidence="sourced",
            year="1860s",
            sign="COLE",
            brick="soft",
            notes="James Cole's brick corner at East Main and Hail. He made the bricks himself in the 1860s from clay dug near the cemetery. He added banking in 1878 and by the mid-1880s had closed out the store to bank full time. The corner is from the 1954 centennial history.",
        ),
    ],
)

# East Main, Hail to Gridley.
row_facing_z(
    30,
    390,
    em_front,
    "+z",
    [
        store(
            "Farmers National Bank",
            "bank",
            "brick-store",
            46,
            70,
            confidence="sourced",
            year="1871",
            sign="FARMERS BANK",
            brick="dark",
            notes="Organized in 1871 from the private bank of Chandler & Cummings, Charles Wilson president. It closed in 1885 after the history was written. A paving petition puts the Bank of Bushnell on East Main. The Hail corner is inferred.",
        ),
        store("Clothing", "clothing", "brick-store", 34, 64),
        store("Grocery", "grocery", "brick-store", 30, 60, brick="soft"),
        store("Millinery", "millinery", "frame-store", 26, 48, paint="yellow"),
        store("Tin & Stoves", "hardware", "frame-store", 28, 55, paint="cream"),
        store("Offices", "upstairs offices", "brick-store", 32, 62, sign="OFFICES"),
        store("Variety", "variety store", "brick-store", 36, 60),
        store("Wagon Shop", "wagon shop", "frame-store", 40, 70, paint="red", stories=1, sign="WAGONS"),
        store("Boots", "boots and shoes", "brick-store", 28, 58),
        store("Grocery", "grocery", "frame-store", 30, 52, paint="white"),
        store("Tailor", "tailor", "brick-store", 30, 56, brick="soft"),
    ],
)

# West Main, Hurst to Hail. Buildings west of the street, facing the tracks (-z).
wm_front = para_at("West Main") + 35  # 191
row_facing_z(
    -390,
    -30,
    wm_front,
    "-z",
    [
        store(
            "Hendee Store",
            "dry goods and bank",
            "brick-store",
            54,
            72,
            confidence="sourced",
            year="1860",
            sign="HENDEE",
            brick="red",
            notes="S. A. Hendee started in Bushnell in 1860. The 1885 history says that first store was on the east side of the railroad. The 1954 centennial calls the brick block at Hurst and West Main the original Hendee building and says it housed Hendee's store and the Chandler bank. Both statements are kept: this is the corner the centennial names, and the 1860 site may have been across the tracks.",
        ),
        store("Saloon", "saloon", "frame-store", 24, 48, paint="darkred", sign="SALOON"),
        store("Grocery", "grocery", "brick-store", 32, 64, brick="dark"),
        store("Harness", "harness", "frame-store", 22, 50, paint="tan"),
        store(
            "Hendee House",
            "hotel",
            "hotel",
            64,
            86,
            stories=3,
            porch=True,
            confidence="sourced",
            year="1871",
            sign="HENDEE HOUSE",
            brick="dark",
            notes="Built in the summer of 1871 by S. A. Hendee. In 1885 Boyington & Son kept it, and the history calls it the best hotel on the railroad between Galesburg and Quincy. It stood on West Main. The lot along this block is inferred. Later it was known as the Alexander.",
        ),
        store("General Store", "general store", "brick-store", 36, 68),
        store(
            "Masonic Hall",
            "store below, lodge above",
            "brick-store",
            48,
            70,
            confidence="sourced",
            year="1859",
            sign="MASONIC HALL",
            brick="red",
            notes="T. J. Pickett Lodge No. 307, A. F. & A. M., was chartered in 1859. By 1885 the lodge owned its building and met in a room 45 by 50 feet. Which Main Street door was theirs is not given, so the hall is placed in the West Main row.",
        ),
        store("Printing Office", "job printing", "frame-store", 22, 46, paint="cream", sign="PRINTER"),
        store("Dry Goods", "dry goods", "brick-store", 40, 70, brick="soft"),
        store("Meat Market", "meat market", "brick-store", 18, 48, sign="MEATS"),
    ],
)

# West Main, Hail to Gridley.
row_facing_z(
    30,
    390,
    wm_front,
    "-z",
    [
        store("Dry Goods", "dry goods", "brick-store", 40, 68, brick="dark"),
        store("Grocery", "grocery", "brick-store", 32, 60),
        store("Furniture", "furniture", "frame-store", 28, 56, paint="white"),
        store("Boarding House", "boarding house", "hotel", 44, 60, stories=2, porch=True, sign="ROOMS", paint="cream", material="frame"),
        store("Hardware", "hardware", "brick-store", 36, 66),
        store("Grain Office", "grain, wood, and coal office", "frame-store", 28, 40, stories=1, paint="tan", sign="GRAIN & COAL", notes="Stockton West dealt in grain, wood, and coal. A small trackside office is inferred; his yard is across the street by the siding."),
        store("Grocery", "grocery", "brick-store", 34, 62, brick="soft"),
        store("Drugs", "drugs", "brick-store", 22, 56),
        store("General Store", "general store", "brick-store", 50, 72, brick="red"),
        store("Public Hall", "upstairs hall", "brick-store", 46, 64, sign="HALL"),
    ],
)

# Fix the boarding house material: store() sets material from kind before extra update...
# I passed material and kind inside store() incorrectly. Let me check store() implementation.
# store() sets material from kind then item.update(extra). extra includes material and kind if passed as kwargs.
# I passed them as keyword via store(..., material="frame", kind="hotel") AFTER sign= which is explicit.
# Looking at the call: store("Boarding House", "boarding house", "hotel", 44, 60, stories=2, porch=True, sign="ROOMS", paint="cream", material="frame", kind="hotel")
# The third positional is kind="hotel", then extra kind="hotel" overwrites, material="frame" overwrites the brick default. Good.

# German row: Hail Street from East Main to Crafford, both sides.
# Southwest side of Hail (Hurst block), beside the Cole Building.
# Cole occupies roughly z -191 down by its depth 74, so z about -265 to -191, x about -78 to -30.
hail_sw = -30  # Hail edge
# Available frontage along z, clear of Cole (Cole depth 74 from z=-191).
place_facing_x(
    hail_sw,
    "+x",
    -300,
    36,
    58,
    id="german-row-1",
    name="German Row Grocery",
    kind="brick-store",
    use="grocery",
    material="brick",
    stories=2,
    confidence="inferred",
    sign="GROCERY",
    brick="soft",
    notes="Hail Street from East Main to Crafford was called German row. The 1900 paving petition describes that block. These storefronts are the row; individual German firms are not pinned to doors.",
)
place_facing_x(hail_sw, "+x", -346, 32, 54, name="Shoemaker", kind="frame-store", use="shoes", material="frame", stories=2, paint="cream", sign="SHOES", confidence="inferred", notes=NOTE_ROW)
place_facing_x(hail_sw, "+x", -390, 40, 60, name="Dry Goods", kind="brick-store", use="dry goods", material="brick", stories=2, sign="DRY GOODS", confidence="inferred", notes=NOTE_ROW, brick="red")
place_facing_x(hail_sw, "+x", -440, 28, 48, name="Bakery", kind="frame-store", use="bakery", material="frame", stories=2, paint="white", sign="BAKERY", confidence="inferred", notes=NOTE_ROW)
place_facing_x(hail_sw, "+x", -486, 36, 56, name="Tailor", kind="brick-store", use="tailor", material="brick", stories=2, sign="TAILOR", brick="dark", confidence="inferred", notes=NOTE_ROW)

# Northeast side of Hail, East Main to Crafford.
hail_ne = 30
# Start clear of the Farmers Bank, which turns the Hail corner and reaches about z=-261.
place_facing_x(hail_ne, "-x", -330, 40, 62, name="Grocery", kind="brick-store", use="grocery", material="brick", stories=2, sign="GROCERY", confidence="inferred", notes=NOTE_ROW, brick="red")
place_facing_x(hail_ne, "-x", -378, 34, 55, name="Drugs", kind="brick-store", use="drugs", material="brick", stories=2, sign="DRUGS", confidence="inferred", notes=NOTE_ROW)
place_facing_x(hail_ne, "-x", -424, 30, 50, name="Barber", kind="frame-store", use="barber", material="frame", stories=2, paint="green", sign="BARBER", confidence="inferred", notes=NOTE_ROW)
place_facing_x(hail_ne, "-x", -470, 36, 58, name="Hardware", kind="brick-store", use="hardware", material="brick", stories=2, sign="HARDWARE", brick="soft", confidence="inferred", notes=NOTE_ROW)

# Hotels off the Main rows.
# St. Charles on Hurst, west side, just past Dean.
place_facing_x(
    -420 - 30,
    "-x",
    700,
    44,
    64,
    name="St. Charles Hotel",
    kind="hotel",
    use="hotel",
    material="frame",
    stories=2,
    porch=True,
    paint="cream",
    sign="ST. CHARLES",
    confidence="sourced",
    notes="The St. Charles was kept by L. H. Green on Hurst Street. The side of Hurst and the lot are inferred.",
)
# American House on East Hurst.
place_facing_x(
    -420 + 30,
    "+x",
    -360,
    40,
    58,
    name="American House",
    kind="hotel",
    use="hotel",
    material="frame",
    stories=2,
    porch=True,
    paint="white",
    sign="AMERICAN HOUSE",
    confidence="sourced",
    notes="The centennial history calls the American House one of Bushnell's first hotels and says the old frame building stood on East Hurst. The lot along East Hurst is inferred.",
)
# National Hotel opposite East Park, across Crafford.
# Park is Barnes-Hurst, East Main-Crafford. The far curb of Crafford is z=-611.
# Hotel faces +z toward the park, so its center sits further east.
add_building(
    id="national-hotel",
    name="National Hotel",
    kind="hotel",
    use="hotel",
    material="frame",
    stories=2,
    width=46,
    depth=62,
    x=-640,
    z=-642,
    facing="+z",
    porch=True,
    paint="cream",
    sign="NATIONAL HOTEL",
    confidence="sourced",
    notes="Built by the Negleys and later kept by A. Hess on Crafford Street, opposite the East Park. The park block is inferred, and the hotel is placed across Crafford from that block.",
)

# Churches.
add_building(
    id="christian-church",
    name="Christian Church",
    kind="church",
    use="church",
    material="frame",
    stories=1,
    width=40,
    depth=64,
    x=-360,
    z=640,
    facing="-x",
    paint="white",
    sign="CHRISTIAN CHURCH",
    confidence="sourced",
    steeple=True,
    notes="The old Christian Church stood at the corner of Hurst and Dean, later the fire-house corner. Placed on that corner, on the downtown side. Frame construction is inferred.",
)
add_building(
    id="presbyterian-church",
    name="Presbyterian Church",
    kind="church",
    use="church",
    material="brick",
    stories=1,
    width=42,
    depth=70,
    x=-390,
    z=860,
    facing="+x",
    brick="red",
    sign="PRESBYTERIAN",
    confidence="inferred",
    steeple=True,
    notes="A Presbyterian congregation was here by the 1880s, and a later church stands on West Hurst. A centennial photo taken by the Presbyterian Church shows the Christian Church at Hurst and Dean, so the two stood near each other. This lot is inferred.",
)
add_building(
    id="methodist-church",
    name="Methodist Episcopal Church",
    kind="church",
    use="church",
    material="brick",
    stories=1,
    width=44,
    depth=72,
    x=120,
    z=-780,
    facing="-z",
    brick="dark",
    sign="M. E. CHURCH",
    confidence="inferred",
    steeple=True,
    notes="Methodist and German Methodist congregations are named in the 1885 biographies. Their buildings are not pinned to a corner in the sources used here, so this church marks the denomination on a residential block east of Crafford.",
)

# Depot and railroad buildings. Long axis along the tracks (local width = along x).
add_building(
    id="cbq-depot",
    name="C. B. & Q. Depot",
    kind="depot",
    use="passenger and freight depot",
    material="frame",
    stories=1,
    width=88,
    depth=28,
    x=-210,
    z=36,
    facing="-z",
    paint="depot",
    sign="BUSHNELL",
    confidence="sourced",
    year="1850s",
    notes="The Northern Cross, later the Chicago, Burlington & Quincy, built the first depot. A newer CB&Q depot came after 1900, and the old one was moved and reused as a freight house. The 1880 building is that earlier wooden depot, set in the grounds between East Main and West Main near Hail and Hurst. The Bushnell House was remembered as opposite the Q station.",
)
add_building(
    id="depot-lunch",
    name="Depot Lunch Room",
    kind="frame-store",
    use="lunch room",
    material="frame",
    stories=1,
    width=20,
    depth=16,
    x=-150,
    z=34,
    facing="-z",
    paint="cream",
    sign="LUNCH",
    confidence="inferred",
    notes="J. M. Varner & Son kept the depot lunch room. The 1885 history describes the business; the year it opened is not stated, so it is shown as a small frame room by the platform.",
)
add_building(
    id="hendee-elevator",
    name="Hendee Elevator",
    kind="elevator",
    use="grain elevator",
    material="frame",
    stories=4,
    width=42,
    depth=66,
    x=40,
    z=78,
    facing="-z",
    paint="red",
    sign="HENDEE",
    confidence="sourced",
    year="1880",
    notes="Built in 1880 by S. A. Hendee & Co. when D. F. Chidester joined the firm. The history gives 42 by 66 feet on the ground and 27,000 bushels. A later photo shows an elevator across from the Hendee House. It is placed on the siding between the hotel and Hail.",
)
add_building(
    id="freight-house",
    name="Freight House",
    kind="shed",
    use="railroad freight house",
    material="frame",
    stories=1,
    width=50,
    depth=24,
    x=-340,
    z=40,
    facing="-z",
    paint="depot",
    sign="FREIGHT",
    confidence="inferred",
    notes="A freight house beside the depot is the usual CB&Q arrangement and matches the open railroad ground on the 1886 Sanborn. The exact shed is inferred.",
)
add_building(
    id="coal-shed",
    name="Coal & Wood Yard",
    kind="shed",
    use="coal and wood yard",
    material="frame",
    stories=1,
    width=36,
    depth=22,
    x=180,
    z=55,
    facing="-z",
    paint="gray",
    sign="COAL & WOOD",
    confidence="inferred",
    notes="Stockton West sold grain, wood, and coal. The yard is placed on the siding. The business is documented; the shed's spot is inferred.",
)

# Mills toward Davis, in the railroad ground.
add_building(
    id="depot-mill",
    name="Depot Mill",
    kind="mill",
    use="flour mill",
    material="frame",
    stories=2,
    width=40,
    depth=56,
    x=-980,
    z=48,
    facing="-z",
    paint="cream",
    sign="DEPOT MILL",
    confidence="sourced",
    notes="The Depot Mill stood by the railroad and was owned by M. H. Hicks. The centennial history places it across from the later Vaughan & Bushnell factory. The footing southwest of the passenger depot is inferred.",
)
add_building(
    id="excelsior-mill",
    name="Excelsior Mill",
    kind="mill",
    use="steam flour mill",
    material="brick",
    stories=2,
    width=50,
    depth=70,
    x=-1120,
    z=-40,
    facing="+z",
    brick="red",
    sign="EXCELSIOR MILL",
    confidence="sourced",
    year="before 1884",
    notes="The Excelsior steam flouring mill was built by Nevious Bros. It failed in the fall of 1884 along with the Farmers National Bank, so it was standing in 1880. The centennial history says it stood just west of the Depot Mill. Brick and the smokestack suit a steam mill; the exact corner is inferred.",
)

# TP&W. Track crosses the CB&Q near x=-1640, about 26 degrees off a cross street.
# Depot just west of West Main (z > 191) and southwest of the CB&Q depot.
add_building(
    id="tpw-depot",
    name="T. P. & W. Depot",
    kind="depot",
    use="passenger depot",
    material="frame",
    stories=1,
    width=64,
    depth=24,
    x=-1760,
    z=280,
    facing="-z",
    paint="tan",
    sign="T. P. & W.",
    confidence="sourced",
    year="1869",
    rotation=26,
    notes="The Toledo, Peoria & Warsaw (later called the Toledo, Peoria & Western, and by 1885 part of the Wabash) was surveyed through Bushnell in 1867 and crossed the CB&Q. A 1914 postcard places the depot south of the CB&Q station and just west of West Main. The building is turned to sit beside the east-west track.",
)
add_building(
    id="sorter-house",
    name="Sorter House",
    kind="hotel",
    use="hotel",
    material="frame",
    stories=2,
    width=40,
    depth=56,
    x=-1680,
    z=430,
    facing="-z",
    porch=True,
    paint="white",
    sign="SORTER HOUSE",
    confidence="sourced",
    notes="The Sorter House stood opposite the T. P. & W. station. Placed across from the depot used here. T. J. Sorter appears among the 1882 charter members of the local Knights of Pythias.",
)
add_building(
    id="pump-works",
    name="Bushnell Pump Company",
    kind="factory",
    use="wooden pumps and windmills",
    material="frame",
    stories=2,
    width=70,
    depth=40,
    x=-1880,
    z=160,
    facing="+z",
    paint="red",
    sign="PUMP WORKS",
    confidence="sourced",
    year="1872",
    notes="Nelson, LaTourette & Company opened the works in 1872. By 1885 the Bushnell Pump Company occupied a large frame building opposite the old Wabash depot and made wooden pumps, windmills, and croquet sets. Placed across the T. P. & W. grounds from the depot.",
)
add_building(
    id="roach-livery",
    name="Roach Livery",
    kind="barn",
    use="livery stable",
    material="frame",
    stories=2,
    width=48,
    depth=72,
    x=-760,
    z=250,
    facing="-z",
    paint="red",
    sign="LIVERY",
    confidence="sourced",
    notes="John Roach had kept a livery in Bushnell for about ten years by 1885, so a stable was here around 1880. The history places it at the corner of West Main and First Street. No First Street survives on the plat, so the barn is shown at West Main near Barnes. The big 45-by-80 barn with a 15-by-80 shed was built in 1885, just after this scene, and is drawn a little smaller.",
)

# Give every building an id if missing.
for i, b in enumerate(buildings):
    if "id" not in b:
        slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in b["name"]).strip("-")
        b["id"] = f"{slug}-{i}"
    b.setdefault("year", "")
    b.setdefault("steeple", False)
    b.setdefault("rotation", 0)


# ---------------------------------------------------------------------------
# Houses on residential edges
# ---------------------------------------------------------------------------

occupied = []


def aabb(b):
    w, d = b["width"], b["depth"]
    rot = {"+z": 0, "-z": math.pi, "+x": math.pi / 2, "-x": -math.pi / 2}[b["facing"]]
    rot += math.radians(b.get("rotation") or 0)
    c, s = math.cos(rot), math.sin(rot)
    pts = []
    for lx in (-w / 2, w / 2):
        for lz in (-d / 2, d / 2):
            pts.append((b["x"] + lx * c + lz * s, b["z"] - lx * s + lz * c))
    xs = [p[0] for p in pts]
    zs = [p[1] for p in pts]
    return min(xs), max(xs), min(zs), max(zs)


for b in buildings:
    occupied.append(aabb(b))


def hits(box, pad=2):
    ax0, ax1, az0, az1 = box
    for bx0, bx1, bz0, bz1 in occupied:
        if ax1 > bx0 + pad and ax0 < bx1 - pad and az1 > bz0 + pad and az0 < bz1 - pad:
            return True
    return False


PAINTS = ["white", "cream", "yellow", "gray", "red", "green"]
HOUSE_NAMES = ["Frame house", "Cottage", "Gable house", "Family home"]


def try_house(x, z, width, depth, facing):
    b = dict(
        name=rng.choice(HOUSE_NAMES),
        kind="house",
        use="dwelling",
        material="frame",
        stories=1 if rng.random() < 0.75 else 2,
        width=width,
        depth=depth,
        x=round(x, 2),
        z=round(z, 2),
        facing=facing,
        paint=rng.choice(PAINTS),
        porch=rng.random() < 0.75,
        sign="",
        confidence="inferred",
        notes=NOTE_HOUSE,
        party=[],
        brick="red",
        year="",
        steeple=False,
        rotation=0,
    )
    box = aabb(b)
    if hits(box, pad=1.5):
        return False
    occupied.append(box)
    buildings.append(b)
    return True


# One house on most platted lots, set back from the street the lot faces.
# About one lot in four stays open, the way a young town actually looked.
for lot in lots:
    if lot["use"] == "park":
        continue
    if rng.random() < 0.28:
        continue
    side = "low" if "-lot-low-" in lot["id"] else "high"
    hw = rng.choice([24, 26, 28, 30, 32])
    hd = rng.choice([32, 34, 36, 40])
    setback = rng.choice([18, 20, 22, 26])
    front = lot["z"] - lot["depth"] / 2 if side == "low" else lot["z"] + lot["depth"] / 2
    if side == "low":
        cz = front + setback + hd / 2
        facing = "-z"
    else:
        cz = front - setback - hd / 2
        facing = "+z"
    # Keep the house on its own 60-foot frontage, not across a neighbor.
    cx = lot["x"] + rng.uniform(-8, 8)
    try_house(cx, cz, hw, hd, facing)

for i, b in enumerate(buildings):
    if "id" not in b:
        b["id"] = f"house-{i}"


# ---------------------------------------------------------------------------
# Streets, boardwalks, tracks, trees, props
# ---------------------------------------------------------------------------

streets = []
x_min, x_max = -2100, 1100
z_min, z_max = -1700, 1700
for name, x in CROSS:
    streets.append(
        {
            "name": name + " Street",
            "axis": "z",
            "at": x,
            "width": CROSS_W,
            "from": z_min,
            "to": z_max,
        }
    )
for name, z, w in PARALLEL:
    streets.append(
        {
            "name": name + " Street",
            "axis": "x",
            "at": z,
            "width": w,
            "from": x_min,
            "to": x_max,
        }
    )

def walk(axis, at, a, b, width=8):
    boardwalks.append({"axis": axis, "at": at, "from": a, "to": b, "width": width})


# Boardwalks on the store side of the Main streets, Barnes to Gridley.
walk("x", em_front + 5, -810, 390)  # just inside the East Main roadway
walk("x", wm_front - 5, -810, 390)
# Hail, East Main to Crafford, both sides.
walk("z", -22, -540, -200)
walk("z", 22, -540, -200)
# Short walks on Hurst near Main.
walk("z", -442, -191, -120)
walk("z", -398, 121, 191)

# Hitching posts along the Main boardwalks.
for x in range(-760, 380, 42):
    props.append({"type": "hitching", "x": x, "z": em_front + 12})
    props.append({"type": "hitching", "x": x, "z": wm_front - 12})
props.append({"type": "trough", "x": -20, "z": em_front + 16})
props.append({"type": "trough", "x": -200, "z": wm_front - 16})

# Oil lamps at the main corners.
for x in (-420, 0, 420):
    for z in (em_front + 10, wm_front - 10):
        props.append({"type": "lamp", "x": x + 18, "z": z})

# Telegraph along the west side of the CB&Q.
for x in range(-2000, 1050, 140):
    props.append({"type": "telegraph", "x": x, "z": 22})

# Wagons, horses, barrels.
props.append({"type": "wagon", "x": -80, "z": -150, "rotation": 0.4})
props.append({"type": "horse", "x": -100, "z": -168, "rotation": 0.2})
props.append({"type": "wagon", "x": -260, "z": 145, "rotation": 1.2})
props.append({"type": "horse", "x": 60, "z": 170, "rotation": -0.4})
props.append({"type": "wagon", "x": 220, "z": -150, "rotation": 0.1})
props.append({"type": "barrels", "x": -48, "z": -198})
props.append({"type": "barrels", "x": -300, "z": 198})
props.append({"type": "crates", "x": 70, "z": -198})
props.append({"type": "lumber", "x": 200, "z": 70})
props.append({"type": "coal", "x": 150, "z": 48})
props.append({"type": "pump", "x": -430, "z": -160})
props.append({"type": "pump", "x": 20, "z": 220})

# Crossbucks where streets cross the CB&Q (z=0) and where the TP&W crosses Main.
for name, x in CROSS:
    props.append({"type": "crossbuck", "x": x - 24, "z": -8, "railroad": "C. B. & Q."})
# TP&W line: x = -1640 + (z / 0.899) * -0.438
def tpw_x(z):
    return -1640 + (z / 0.899) * -0.438

props.append({"type": "crossbuck", "x": tpw_x(156) + 16, "z": 170, "railroad": "T. P. & W."})
props.append({"type": "crossbuck", "x": tpw_x(-156) - 16, "z": -170, "railroad": "T. P. & W."})

# Bandstand in East Park. Park box x -810..-450, z -551..-191. Center about -630, -371.
props.append({"type": "bandstand", "x": -630, "z": -370})

# Trees. Maples in both parks, plus yard trees.
def park_trees(x0, x1, z0, z1, n):
    for _ in range(n):
        trees.append(
            {
                "x": round(rng.uniform(x0 + 18, x1 - 18), 1),
                "z": round(rng.uniform(z0 + 18, z1 - 18), 1),
                "kind": "maple",
                "scale": round(rng.uniform(0.85, 1.25), 2),
            }
        )


park_trees(-800, -460, -540, -210, 28)
park_trees(-800, -460, 220, 540, 26)
# Street and yard trees, avoiding the business fronts.
for _ in range(70):
    x = rng.uniform(-1500, 900)
    z = rng.uniform(-1500, 1500)
    # Keep the Main business streets and the tracks clear.
    if -220 < z < 220 and -900 < x < 500:
        continue
    if hits((x - 6, x + 6, z - 6, z + 6), pad=0):
        continue
    trees.append({"x": round(x, 1), "z": round(z, 1), "kind": rng.choice(["maple", "shade"]), "scale": round(rng.uniform(0.7, 1.15), 2)})

# Overlap report for buildings.
overlaps = 0
boxes = [(b["id"], aabb(b)) for b in buildings]
for i in range(len(boxes)):
    ai, (a0, a1, b0, b1) = boxes[i][0], boxes[i][1]
    for j in range(i + 1, len(boxes)):
        aj, (c0, c1, d0, d1) = boxes[j][0], boxes[j][1]
        if a1 > c0 + 1 and a0 < c1 - 1 and b1 > d0 + 1 and a0 < c1 and b1 > d0 and b0 < d1 - 1:
            # recompute properly
            if a1 > c0 + 1.2 and a0 < c1 - 1.2 and b1 > d0 + 1.2 and b0 < d1 - 1.2:
                overlaps += 1
                if overlaps <= 12:
                    print(f"overlap {ai} {boxes[i][1]} WITH {aj} {boxes[j][1]}")

print(f"buildings {len(buildings)} lots {len(lots)} blocks {len(blocks)} trees {len(trees)} overlaps {overlaps}")

# Tracks as polylines in feet.
tracks = [
    {
        "id": "cbq-main",
        "railroad": "Chicago, Burlington & Quincy",
        "name": "C. B. & Q. main line",
        "points": [[x_min, 0], [x_max, 0]],
        "confidence": "sourced",
        "notes": "The Northern Cross, renamed into the CB&Q, was graded across the town site before the 1854 plat. Streets were laid parallel to it. One main track plus a siding is inferred; the 1886 map shows railroad ground wide enough for more than a single rail.",
    },
    {
        "id": "cbq-siding",
        "railroad": "Chicago, Burlington & Quincy",
        "name": "House track",
        "points": [[-500, 16], [400, 16]],
        "confidence": "inferred",
        "notes": "A siding serving the depot and the 1880 elevator. The alignment beside the depot is inferred.",
    },
    {
        "id": "tpw",
        "railroad": "Toledo, Peoria & Western",
        "name": "T. P. & W.",
        "points": [[round(tpw_x(z), 1), z] for z in range(-1600, 1700, 200)],
        "confidence": "sourced",
        "notes": "Surveyed through Bushnell in 1867. By 1885 the county history calls it part of the Wabash. It runs nearly east-west and crosses the CB&Q at a slant southwest of Davis Street, which matches the modern Keokuk Junction alignment that inherited the route.",
    },
]

places = [
    {
        "id": "hail-main",
        "name": "Hail and East Main",
        "x": 48,
        "z": -160,
        "look": [-80, -210],
        "blurb": "The corner of Hail and East Main. Cole's brick building is on the far corner. German row runs off Hail.",
    },
    {
        "id": "depot",
        "name": "C. B. & Q. depot",
        "x": -210,
        "z": 110,
        "look": [-210, 36],
        "blurb": "The wooden Burlington depot between the two Main streets, with the elevator down the siding.",
    },
    {
        "id": "west-main",
        "name": "West Main hotels",
        "x": -180,
        "z": 145,
        "look": [-180, 230],
        "blurb": "West Main, looking at the Hendee House and Hendee's store toward Hurst.",
    },
    {
        "id": "german-row",
        "name": "German row",
        "x": -8,
        "z": -400,
        "look": [-40, -400],
        "blurb": "Hail Street between East Main and Crafford, called German row.",
    },
    {
        "id": "east-park",
        "name": "East Park",
        "x": -630,
        "z": -300,
        "look": [-630, -370],
        "blurb": "The east park, with soft maples and the bandstand. The National Hotel is across Crafford.",
    },
    {
        "id": "crossing",
        "name": "Railroad crossing",
        "x": -1500,
        "z": 80,
        "look": [-1640, 0],
        "blurb": "Where the T. P. & W. crosses the Burlington, southwest of Davis Street.",
    },
]

data = {
    "meta": {
        "project": "Ghost Town",
        "place": "Downtown Bushnell, McDonough County, Illinois",
        "year": 1880,
        "units": "feet",
        "axes": {
            "x": "Northeast along the Chicago, Burlington & Quincy tracks. Positive x is toward Gridley Street and Galesburg. Hail Street is x = 0.",
            "z": "Northwest, across the tracks. Positive z is the west side of town (West Main, Dean, Jackson). Negative z is the east side (East Main, Crafford, Rile). The CB&Q centerline is z = 0.",
            "y": "Up.",
        },
        "grid": {
            "block": 360,
            "street": 60,
            "mainStreet": 70,
            "railroadReserve": 242,
            "centerToCenter": 420,
            "trackBearingDegreesFromNorth": 30.4,
        },
        "population1880": 2316,
        "note": "Edit this file to correct a building. The viewer reads it on each load. Confidence is 'sourced' when a history or map supports the building, and 'inferred' when the block is right but the door, owner, or exact footprint is a stand-in.",
    },
    "streets": streets,
    "tracks": tracks,
    "blocks": blocks,
    "lots": lots,
    "buildings": buildings,
    "boardwalks": boardwalks,
    "trees": trees,
    "props": props,
    "places": places,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(data, indent=2))
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
