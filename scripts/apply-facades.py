#!/usr/bin/env python3
"""Add photo-matched facades, the 500 block notes, and Gridley Street buildings.

Edits public/data/bushnell-1880.json in place. Safe to run again.
"""

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "public" / "data" / "bushnell-1880.json"

NOTE_500_EAST = (
    "This front is on the 500 block of East Main, the block from Hail Street to Gridley Street. "
    "Bushnell ordered the streets marked and the houses numbered in April 1909, so there is no 1880 "
    "address of 500. Today's 500 East Main falls on this block: 400 starts at Hurst, 500 at Hail, "
    "and 590 is still short of Gridley. The shop itself is a stand-in. Its door is not in a photograph."
)
NOTE_500_WEST = (
    "This front is on the 500 block of West Main, Hail Street to Gridley Street, the same 1909 numbering "
    "as East Main. A 1900 photograph of West Main shows brick stores with awnings beside frame false fronts. "
    "The awning on this building follows that picture. The picture does not name this door."
)


def aabb(b):
    w, d = b["width"], b["depth"]
    rot = {"+z": 0, "-z": math.pi, "+x": math.pi / 2, "-x": -math.pi / 2}[b["facing"]]
    rot += math.radians(b.get("rotation") or 0)
    c, s = math.cos(rot), math.sin(rot)
    xs, zs = [], []
    for lx in (-w / 2, w / 2):
        for lz in (-d / 2, d / 2):
            xs.append(b["x"] + lx * c + lz * s)
            zs.append(b["z"] - lx * s + lz * c)
    return min(xs), max(xs), min(zs), max(zs)


def hits(a, b, pad=1.5):
    ax0, ax1, az0, az1 = a
    bx0, bx1, bz0, bz1 = b
    return ax1 > bx0 + pad and ax0 < bx1 - pad and az1 > bz0 + pad and az0 < bz1 - pad


def main():
    data = json.loads(PATH.read_text())
    buildings = data["buildings"]
    by_id = {b["id"]: b for b in buildings}

    cole = by_id["cole-building-10"]
    cole["party"] = ["left"]
    cole["brick"] = "soft"
    cole["sign"] = "COLE"
    cole["facade"] = {
        "photoMatch": True,
        "photoDate": "1860s building. The photograph is undated and was printed in 1954. An early-1900s view of a taller round-arched Cole Block was not used.",
        "photoSource": "Bushnell, Illinois, centennial, 1854–1954. The photograph is captioned as the original Cole building at East Main and Hail.",
        "arches": "segmental",
        "bays": 4,
        "sideBays": 5,
        "door": "right",
        "cornice": "bracket",
        "storefront": "iron",
        "roof": "flat",
        "pilasters": True,
    }
    cole["notes"] = (
        "James Cole's brick corner at East Main and Hail. He made the bricks himself in the 1860s from clay dug near the cemetery pond. "
        "He added banking in 1878. The front is matched to the centennial photograph of that original building: two stories of soft red brick, "
        "four segmental-arched windows upstairs, a bracketed cornice, pilasters, and a cast-iron storefront with the door at the Hail corner. "
        "The same book shows a taller round-arched 'Cole Block in the early 1900s.' That later front is not the 1880 building, so it is not drawn."
    )

    hendee = by_id["hendee-store-22"]
    hendee["party"] = ["left"]
    hendee["brick"] = "red"
    hendee["sign"] = "HENDEE"
    hendee["facade"] = {
        "photoMatch": True,
        "photoDate": "The store began in 1860. The photograph is undated and is printed in the 1954 centennial next to the 1903 notes.",
        "photoSource": "Bushnell centennial. The photograph is captioned as the original Hendee building at Hurst and West Main, housing the Chandler bank and Hendee's store.",
        "arches": "segmental",
        "bays": 3,
        "sideBays": 4,
        "door": "right",
        "cornice": "bracket",
        "storefront": "iron",
        "roof": "flat",
        "pilasters": True,
    }
    hendee["notes"] = (
        "The brick block at Hurst and West Main. The 1954 centennial calls it the original Hendee building and says it housed Hendee's store and the Chandler bank. "
        "The 1885 history says S. A. Hendee started on the east side of the railroad in 1860, so the first counter may have been across the tracks. "
        "The front is matched to the centennial photograph: two stories of red brick, three bays of segmental-arched upstairs windows, a bracketed cornice, "
        "and a cast-iron storefront with the entrance at the Hurst corner. The photograph is undated."
    )

    elevator = by_id["hendee-elevator"]
    elevator["facade"] = {
        "photoMatch": True,
        "photoDate": "Built in 1880. The photograph was taken about 1902 from the Alexander Hotel, so the cupola is read from a later picture of the same elevator.",
        "photoSource": "Bushnell centennial. The photograph looks southeast from the Alexander Hotel and shows the end of the Hendee elevator across the street.",
        "cupola": True,
        "roof": "gable",
    }
    elevator["notes"] = (
        "Built in 1880 by S. A. Hendee & Co., 42 by 66 feet and 27,000 bushels. "
        "The tall wooden elevator, gable roof, cupola, and driveway shed follow a photograph taken about 1902 from the Alexander Hotel, looking southeast. "
        "The siding spot between the hotel and Hail is inferred from that view."
    )

    # Ball Bros. replaces the stand-in tailor at the Gridley end of the East Main 500 block.
    tailor = by_id.get("tailor-21")
    ball = {
        "id": "ball-bros",
        "name": "Ball Bros.",
        "kind": "frame-store",
        "use": "wagon and carriage shop",
        "material": "frame",
        "stories": 2,
        "width": 30,
        "depth": 60,
        "x": 375,
        "z": -221,
        "facing": "+z",
        "paint": "cream",
        "brick": "red",
        "sign": "BALL BROS.",
        "porch": False,
        "party": ["left"],
        "confidence": "sourced",
        "year": "1880s",
        "steeple": False,
        "rotation": 0,
        "facade": {
            "photoMatch": True,
            "photoDate": "The 1880s, as captioned. Printed in the 1954 centennial.",
            "photoSource": "Bushnell centennial. The photograph is captioned 'The Ball Bros. corner in the 80's at East Main and Gridley Streets.'",
            "arches": "flat",
            "bays": 3,
            "sideBays": 2,
            "door": "center",
            "cornice": "plain",
            "storefront": "wood",
            "shedPorch": True,
            "peak": True,
            "roof": "falsefront",
        },
        "notes": (
            "Ball & Sons were the town's wagon and carriage makers. The centennial photograph, captioned as the Ball Bros. corner in the 1880s, "
            "shows a two-story frame building with a false front and a center gable, three upstairs windows, a double door between two shop windows, "
            "and a shed porch, at East Main and Gridley. Markham's store at this corner had been the first post office; by the 1880s the corner in the picture is Ball's. "
            "The 1900 paving petition starts East Main at Ball's carriage shop and runs to the Bank of Bushnell, which puts the shop at the Gridley end of this block. "
            "This is the 500 block of East Main."
        ),
    }
    if tailor and tailor in buildings:
        buildings.remove(tailor)
    if "ball-bros" in by_id:
        buildings.remove(by_id["ball-bros"])
    buildings.append(ball)

    church = {
        "id": "reformed-church",
        "name": "Reformed Church",
        "kind": "church",
        "use": "church",
        "material": "frame",
        "stories": 1,
        "width": 36,
        "depth": 54,
        "x": 477,
        "z": -528,
        "facing": "-x",
        "paint": "white",
        "brick": "red",
        "sign": "REFORMED CHURCH",
        "porch": False,
        "party": [],
        "confidence": "sourced",
        "year": "1861",
        "steeple": True,
        "rotation": 0,
        "notes": (
            "Organized October 19, 1856. The church was built in 1860 or 1861 at the northwest corner of East Gridley and Crafford, "
            "and dedicated May 1, 1861. No photograph of the building was found, so the white frame walls and steeple are the ordinary shape, not a matched front. "
            "Northwest here means the corner toward Wells and toward the tracks."
        ),
    }
    if "reformed-church" in by_id:
        buildings.remove(by_id["reformed-church"])
    # drop a previous run's gridley houses before placing them again
    buildings[:] = [b for b in buildings if not str(b["id"]).startswith("gridley-")]
    buildings.append(church)

    def occupied():
        return [(b, aabb(b)) for b in buildings]

    def blocked(spec, pad=1.2):
        box = aabb(spec)
        for other, ob in occupied():
            if other.get("id") == spec.get("id"):
                continue
            if hits(box, ob, pad):
                return other["id"]
        return None

    # Drop houses that sit on the church or on the new Gridley fronts.
    protected = {b["id"] for b in buildings if b["kind"] != "house"}

    gridley = []
    # depth is front-to-back, so a house facing Gridley is deep across x.
    depth = 34
    width = 26
    x_hail = 390 - depth / 2  # southwest side of Gridley, facing +x
    x_wells = 450 + depth / 2  # northeast side, facing -x
    east_zs = [-360, -440, -640, -720, -800, -880, -980, -1080]
    west_zs = [320, 400, 500, 620, 700, 780, 860, 960, 1060, 1160]
    paints = ["white", "cream", "yellow", "gray", "green"]
    n = 0
    for side_name, x, facing, zs in (
        ("east-hail", x_hail, "+x", east_zs),
        ("east-wells", x_wells, "-x", east_zs),
        ("west-hail", x_hail, "+x", west_zs),
        ("west-wells", x_wells, "-x", west_zs),
    ):
        for z in zs:
            n += 1
            house = {
                "id": f"gridley-{side_name}-{n}",
                "name": "Gridley Street house",
                "kind": "house",
                "use": "dwelling",
                "material": "frame",
                "stories": 2 if n % 4 == 0 else 1,
                "width": width,
                "depth": depth,
                "x": round(x, 2),
                "z": z,
                "facing": facing,
                "paint": paints[n % len(paints)],
                "brick": "red",
                "sign": "",
                "porch": True,
                "party": [],
                "confidence": "inferred",
                "year": "",
                "steeple": False,
                "rotation": 0,
                "notes": (
                    "A house facing Gridley Street. A photograph in the 1954 centennial, taken while East and West Main were being paved "
                    "and captioned as a view west on Gridley from East Main, shows frame houses with porches along this street. "
                    "That paving was finished in 1904, so the picture is later than 1880. These houses follow that street, not one particular home. "
                    "No name is attached to this door."
                ),
            }
            gridley.append(house)

    # Remove older houses that would overlap a Gridley house or the church.
    newcomers = gridley + [church, ball]
    new_boxes = [(b, aabb(b)) for b in newcomers]
    kept = []
    removed = []
    for b in buildings:
        if b["kind"] == "house" and b["id"] not in protected:
            box = aabb(b)
            if any(hits(box, nb, 1.0) for _, nb in new_boxes):
                removed.append(b["id"])
                continue
        kept.append(b)
    buildings[:] = kept

    placed = 0
    skipped = []
    for house in gridley:
        why = blocked(house, pad=1.0)
        if why:
            skipped.append((house["id"], why))
            continue
        buildings.append(house)
        placed += 1

    # 500 block labels and West Main awnings.
    for b in buildings:
        on_east = 20 < b["x"] < 400 and b["z"] < -180 and b["facing"] == "+z" and b["kind"] in ("brick-store", "frame-store", "hotel")
        on_west = 20 < b["x"] < 400 and b["z"] > 180 and b["facing"] == "-z" and b["kind"] in ("brick-store", "frame-store", "hotel")
        if b["id"] == "ball-bros":
            continue
        if on_east and "500 block of East Main" not in b.get("notes", ""):
            b["notes"] = (b.get("notes") or "").rstrip() + " " + NOTE_500_EAST
        if on_west:
            if "500 block of West Main" not in b.get("notes", ""):
                b["notes"] = (b.get("notes") or "").rstrip() + " " + NOTE_500_WEST
            if not b.get("porch") and b["kind"] != "hotel":
                facade = dict(b.get("facade") or {})
                facade["awning"] = True
                facade.setdefault("photoMatch", False)
                b["facade"] = facade

    def add_walk(axis, at, a, b, width=8):
        a, b = (a, b) if a < b else (b, a)
        for w in data["boardwalks"]:
            if w["axis"] == axis and abs(w["at"] - at) < 1 and abs(w["from"] - a) < 5 and abs(w["to"] - b) < 5:
                return
        data["boardwalks"].append({"axis": axis, "at": at, "from": a, "to": b, "width": width})

    add_walk("z", 397, -1100, -210)
    add_walk("z", 443, -1100, -210)
    add_walk("z", 397, 210, 1180)
    add_walk("z", 443, 210, 1180)

    places = data["places"]
    extra_places = [
        {
            "id": "cole",
            "name": "Cole Building",
            "x": -54,
            "z": -125,
            "look": [-54, -240],
            "blurb": "The Cole Building at Hail and East Main, matched to the photograph of the original brick corner.",
        },
        {
            "id": "hendee-store-place",
            "name": "Hendee Store",
            "x": -363,
            "z": 120,
            "look": [-363, 250],
            "blurb": "Hendee's store at Hurst and West Main, matched to the photograph of the original building.",
        },
        {
            "id": "east-500",
            "name": "500 block, East Main",
            "x": 200,
            "z": -115,
            "look": [200, -250],
            "blurb": "The 500 block of East Main, from Hail to Gridley. The numbers date from 1909.",
        },
        {
            "id": "west-500",
            "name": "500 block, West Main",
            "x": 200,
            "z": 120,
            "look": [200, 250],
            "blurb": "The 500 block of West Main, from Hail to Gridley.",
        },
        {
            "id": "gridley",
            "name": "Gridley Street",
            "x": 420,
            "z": -300,
            "look": [420, -620],
            "blurb": "Gridley Street from East Main toward Crafford. Ball Bros. is at the corner. The Reformed Church is farther along.",
        },
        {
            "id": "ball-corner",
            "name": "Ball Bros. corner",
            "x": 360,
            "z": -140,
            "look": [374, -230],
            "blurb": "Ball Bros. at East Main and Gridley, matched to the 1880s photograph.",
        },
    ]
    have = {p["id"] for p in places}
    for p in extra_places:
        if p["id"] in have:
            for i, old in enumerate(places):
                if old["id"] == p["id"]:
                    places[i] = p
        else:
            places.append(p)

    # Overlap report
    boxes = [(b["id"], aabb(b)) for b in buildings]
    overlaps = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if hits(boxes[i][1], boxes[j][1], 1.2):
                overlaps.append((boxes[i][0], boxes[j][0]))
    PATH.write_text(json.dumps(data, indent=2) + "\n")
    print(f"buildings {len(buildings)} gridley_placed {placed} houses_removed {len(removed)} overlaps {len(overlaps)}")
    if removed:
        print("removed", ", ".join(removed[:20]))
    if skipped:
        print("skipped", skipped)
    if overlaps:
        print("OVERLAPS")
        for a, b in overlaps[:20]:
            print(" ", a, b)


if __name__ == "__main__":
    main()
