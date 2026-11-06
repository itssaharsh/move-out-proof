#!/usr/bin/env python3
"""Build the staged demo apartment fixture for Move-out Proof.

Usage:
  python3 tools/make_fixture.py          # download (cached), transform, write fixture
  python3 tools/make_fixture.py --check  # verify the fixture, non-zero exit on failure

All photos are free-licence stock photos (CC0 / CC BY-SA from Wikimedia Commons).
Re-shots, stains, nail holes and dates are programmatic. STAGED DEMO: see CREDITS.md.
"""
import json, math, os, random, subprocess, sys, time, urllib.parse
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent / "fixtures" / "apartment"
CACHE = ROOT / ".cache"
OUT_W = 1280
SOFTWARE = "Move-out Proof staged fixture"
DESCRIPTION = "Staged demo apartment (stock photo, see CREDITS.md)"
C = "https://commons.wikimedia.org/wiki/File:"
U = "https://upload.wikimedia.org/wikipedia/commons/"
CC0 = "CC0 1.0"
SA = "CC BY-SA 4.0"

# id -> source metadata. crop = (left, top, right, bottom) fractions of the original.
SOURCES = {
    "oven": dict(file="oven.jpg", crop=(0.28, 0.38, 0.72, 0.86), author="Naomi Hébert (naomish, Unsplash)", license=CC0,
                 source_page=C + "Kitchen_(Unsplash).jpg", image_url=U + "c/c3/Kitchen_%28Unsplash%29.jpg"),
    "carpet": dict(file="carpet.jpg", crop=(0.0, 0.22, 0.50, 0.58), author="Oliur Rahman (ultralinx, Unsplash)", license=CC0,
                   source_page=C + "Laptop_in_the_living_room_(Unsplash).jpg", image_url=U + "7/75/Laptop_in_the_living_room_%28Unsplash%29.jpg"),
    "wall": dict(file="wall.jpg", crop=(0.04, 0.0, 0.96, 0.62), author="Naomi Hébert (naomish, Unsplash)", license=CC0,
                 source_page=C + "At_Home_(Unsplash).jpg", image_url=U + "d/df/At_Home_%28Unsplash%29.jpg"),
    "tub": dict(file="tub.jpg", crop=(0.30, 0.28, 1.0, 0.92), author="Ronnica123 (Wikimedia Commons)", license=SA,
                source_page=C + "Ravak_bathtub_CHROME_2019_(1).jpg", image_url=U + "8/80/Ravak_bathtub_CHROME_2019_%281%29.jpg"),
    "bedroom": dict(file="bedroom.jpg", crop=(0.0, 0.0, 1.0, 0.80), author="Gabriel Beaudry (gbeaudry, Unsplash)", license=CC0,
                    source_page=C + "NY_loft_bedroom_(Unsplash).jpg", image_url=U + "2/29/NY_loft_bedroom_%28Unsplash%29.jpg"),
    "hall": dict(file="hall.jpg", crop=(0, 0, 1, 1), author="Kari Shea (karishea, Unsplash)", license=CC0,
                 source_page=C + "Home_Sweet_Home_Pt._4_(Unsplash).jpg", image_url=U + "2/27/Home_Sweet_Home_Pt._4_%28Unsplash%29.jpg"),
    "beach": dict(file="beach.jpg", crop=(0, 0, 1, 1), author="Dakota Corbin (thedakotacorbin, Unsplash)", license=CC0,
                  source_page=C + "Beach_by_the_pier_(Unsplash).jpg", image_url=U + "1/17/Beach_by_the_pier_%28Unsplash%29.jpg"),
    "pizza": dict(file="pizza.jpg", crop=(0, 0, 1, 1), author="Thomas Schweighofer (Unsplash)", license=CC0,
                  source_page=C + "Margherita_PIzza_(Unsplash).jpg", image_url=U + "3/3a/Margherita_PIzza_%28Unsplash%29.jpg"),
}

IN, OUT = "move-in", "move-out"
# (base_id, window, datetime, spot_truth, state_note, variant)
PLAN = [
    ("oven", IN, "2024-03-12T10:04:12", "kitchen-oven", "clean oven at move-in", "base"),
    ("carpet", IN, "2024-03-12T10:11:40", "living-room-carpet", "coffee stain on carpet, already present at move-in", "base"),
    ("wall", IN, "2024-03-12T10:17:25", "living-room-wall", "clean painted wall, no marks", "base"),
    ("bedroom", IN, "2024-03-12T10:24:08", "bedroom-wall", "clean bedroom wall", "base"),
    ("oven", OUT, "2026-10-30T14:06:31", "kitchen-oven", "oven still clean at move-out (re-shot)", "reshot"),
    ("carpet", OUT, "2026-10-30T14:11:52", "living-room-carpet", "same coffee stain as at move-in (re-shot)", "reshot"),
    ("wall", OUT, "2026-10-30T14:16:07", "living-room-wall", "3 small nail holes and one grey scuff mark, not present at move-in", "wallmarks"),
    ("tub", OUT, "2026-10-30T14:21:44", "bathroom-tub", "bathtub at move-out; NO move-in photo exists (staged gap)", "reshot"),
    ("bedroom", OUT, "2026-10-30T14:27:19", "bedroom-wall", "bedroom wall clean at move-out (re-shot)", "reshot"),
    ("hall", OUT, "2026-10-30T14:33:05", "unclear", "heavily blurred and darkened hallway photo", "blurry"),
    ("beach", "outside", "2025-07-19T16:20:00", "not-a-spot", "holiday beach photo, outside both date windows", "base"),
    ("pizza", "outside", "2025-12-24T19:45:00", "not-a-spot", "plate of food, outside both date windows", "base"),
]

CHARGES = [
    ("Oven deep clean", 180.00, "kitchen-oven"),
    ("Carpet stain treatment, living room", 120.00, "living-room-carpet"),
    ("Wall repair and repaint, living room (nail holes and scuff)", 90.00, "living-room-wall"),
    ("Bathroom deep clean", 30.00, "bathroom-tub"),
]
WINDOWS = {"move_in": {"start": "2024-03-01", "end": "2024-03-31"},
           "move_out": {"start": "2026-10-20", "end": "2026-11-05"}}


def fetch(src):
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / src["file"]
    if p.exists() and p.stat().st_size > 10000:
        return p
    for attempt in range(6):
        r = subprocess.run(["curl", "-sSL", "-m", "120", "-A", "move-out-proof-fixture/1.0 (hackathon demo)",
                            "-o", str(p), "-w", "%{http_code}", src["image_url"]], capture_output=True, text=True)
        if r.stdout.strip() == "200" and p.stat().st_size > 10000:
            return p
        time.sleep(10 * (attempt + 1))
    raise SystemExit("download failed: " + src["image_url"])


def load_base(bid):
    im = Image.open(fetch(SOURCES[bid])).convert("RGB")  # convert drops EXIF
    w, h = im.size
    l, t, r, b = SOURCES[bid]["crop"]
    im = im.crop((int(l * w), int(t * h), int(r * w), int(b * h)))
    h2 = round(im.height * OUT_W / im.width)
    return im.resize((OUT_W, h2), Image.LANCZOS)


def add_stain(im, rng):
    """Semi-transparent brown coffee stain, ~3% of the image area, soft-edged irregular blob."""
    W, H = im.size
    R = math.sqrt(0.03 * W * H / math.pi)
    cx, cy = W * 0.36, H * 0.52
    ph = [rng.uniform(0, 6.28) for _ in range(5)]
    amp = [0.10, 0.08, 0.06, 0.04, 0.03]
    S = 4
    mask = Image.new("L", (W * S, H * S), 0)
    d = ImageDraw.Draw(mask)
    pts = []
    for i in range(240):
        a = 2 * math.pi * i / 240
        rr = R * (1 + sum(amp[k] * math.sin((k + 2) * a + ph[k]) for k in range(5)))
        pts.append(((cx + rr * math.cos(a) * 1.25) * S, (cy + rr * math.sin(a) * 0.80) * S))
    d.polygon(pts, fill=255)
    mask = mask.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(4))
    inner = mask.filter(ImageFilter.MinFilter(13)).filter(ImageFilter.GaussianBlur(8))
    rim = ImageChops.subtract(mask, inner)
    # low-frequency mottling so the stain is uneven like a real spill
    mot = Image.effect_noise((W // 16 + 1, H // 16 + 1), 40).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6))
    mot = mot.point(lambda v: max(0, min(255, int(190 + (v - 128) * 1.6))))
    body = ImageChops.multiply(mask, mot)  # 0..255 scaled
    # multiply keeps carpet pile texture visible through the stain
    tint = ImageChops.multiply(im, Image.new("RGB", (W, H), (172, 128, 92)))
    out = Image.composite(tint, im, body.point(lambda v: int(v * 0.92)))
    dark = ImageChops.multiply(out, Image.new("RGB", (W, H), (150, 104, 70)))
    return Image.composite(dark, out, rim.point(lambda v: int(v * 0.8)))


def reshot(im, rng, side):
    """Re-photograph: crop 4-8% from one side, rotate 1-3 deg, WB/brightness shift, light noise."""
    W, H = im.size
    frac = rng.uniform(0.04, 0.08)
    box = [0, 0, W, H]
    if side == 0: box[0] = int(W * frac)
    elif side == 1: box[2] = W - int(W * frac)
    elif side == 2: box[1] = int(H * frac)
    else: box[3] = H - int(H * frac)
    im = im.crop(box)
    ang = rng.choice([-1, 1]) * rng.uniform(1.0, 3.0)
    im = im.rotate(ang, resample=Image.BICUBIC, expand=False)
    m = math.ceil(max(im.size) * math.sin(math.radians(abs(ang))) * 0.62) + 2  # trim blank corners
    im = im.crop((m, m, im.width - m, im.height - m))
    im = im.resize((OUT_W, round(im.height * OUT_W / im.width)), Image.LANCZOS)
    r, g, b = im.split()
    k = [rng.uniform(0.97, 1.03) for _ in range(3)]
    im = Image.merge("RGB", [c.point(lambda v, f=f: min(255, int(v * f))) for c, f in zip((r, g, b), k)])
    im = ImageEnhance.Brightness(im).enhance(rng.uniform(0.94, 1.05))
    return add_noise(im, rng)


def add_noise(im, rng, sigma=4):
    noise = Image.effect_noise(im.size, sigma)  # gaussian centred on 128
    n3 = Image.merge("RGB", [noise] * 3)
    return ImageChops.add(im, n3, 1.0, -128)  # signed add


def wall_marks(im, rng):
    """3-4 nail holes and one grey scuff, placed on the blank wall left of the picture frame."""
    W, H = im.size
    layer = im.copy()
    holes = [(0.17, 0.26), (0.30, 0.20), (0.26, 0.40), (0.14, 0.50)][: rng.choice([3, 4])]
    # scuff
    sc = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(sc)
    x0, y0 = W * 0.36, H * 0.52
    for i in range(7):
        t = i / 6
        d.ellipse((x0 + t * 70 - 10, y0 - t * 26 - 4 + rng.uniform(-2, 2), x0 + t * 70 + 22, y0 - t * 26 + 6), fill=210)
    sc = sc.filter(ImageFilter.GaussianBlur(3.5))
    grey = Image.new("RGB", (W, H), (112, 112, 116))
    layer = Image.composite(grey, layer, sc.point(lambda v: int(v * 0.55)))
    for fx, fy in holes:
        x, y = fx * W, fy * H
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).ellipse((x - 3.5, y - 3.5, x + 3.5, y + 3.5), fill=255)
        m = m.filter(ImageFilter.GaussianBlur(0.9))
        layer = Image.composite(Image.new("RGB", (W, H), (58, 52, 48)), layer, m)
        hl = Image.new("L", (W, H), 0)  # faint highlight below-right of hole
        ImageDraw.Draw(hl).arc((x - 5.5, y - 5.5, x + 5.5, y + 5.5), 20, 160, fill=255, width=2)
        hl = hl.filter(ImageFilter.GaussianBlur(0.8))
        layer = Image.composite(Image.new("RGB", (W, H), (252, 250, 245)), layer, hl.point(lambda v: int(v * 0.6)))
    return layer


def blurry(im):
    im = ImageEnhance.Brightness(im).enhance(0.32)
    return im.filter(ImageFilter.GaussianBlur(26))


def save_jpeg(im, path, dt):
    path.parent.mkdir(parents=True, exist_ok=True)
    ex = Image.Exif()
    ex[0x010E] = DESCRIPTION
    ex[0x0131] = SOFTWARE
    s = datetime.fromisoformat(dt).strftime("%Y:%m:%d %H:%M:%S")
    ex[0x0132] = s
    ifd = ex.get_ifd(0x8769)
    ifd[0x9003] = s
    ifd[0x9004] = s
    ex[0x8769] = ifd
    im.save(path, "JPEG", quality=85, exif=ex)


def render_letter(path):
    W, H = 1240, 1754
    rng = random.Random(7)
    im = Image.new("RGB", (W, H), (252, 251, 248))
    d = ImageDraw.Draw(im)
    fd = "/usr/share/fonts/truetype/dejavu/"
    def F(sz, bold=False):
        try:
            return ImageFont.truetype(fd + ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"), sz)
        except OSError:
            return ImageFont.load_default()
    ink = (28, 30, 36)
    d.rectangle((0, 0, W, 14), fill=(38, 92, 70))
    d.text((90, 60), "Elmfield Lettings", font=F(44, True), fill=(38, 92, 70))
    d.text((90, 118), "Lettings & Property Management  |  Bristol", font=F(20), fill=(90, 94, 100))
    d.line((90, 160, W - 90, 160), fill=(200, 200, 196), width=2)
    y = 200
    d.text((W - 90, y), "4 November 2026", font=F(24), fill=ink, anchor="ra")
    for ln in ["Alex Morgan", "Flat 3B, 14 Elm Road", "Bristol"]:
        d.text((90, y), ln, font=F(24), fill=ink); y += 36
    y += 30
    d.text((90, y), "Re: Return of tenancy deposit", font=F(28, True), fill=ink); y += 50
    for ln in ["Property: Flat 3B, 14 Elm Road, Bristol",
               "Tenancy: 12 March 2024 to 30 October 2026",
               "Deposit held: £1,200.00"]:
        d.text((90, y), ln, font=F(24), fill=ink); y += 38
    y += 20
    d.text((90, y), "Dear Alex Morgan,", font=F(24), fill=ink); y += 44
    for ln in ["Following the end of your tenancy and our check-out inspection, we propose to make the",
               "deductions below from your deposit."]:
        d.text((90, y), ln, font=F(22), fill=ink); y += 34
    y += 30
    x1, x2 = 90, W - 90
    d.rectangle((x1, y, x2, y + 48), fill=(232, 238, 234))
    d.text((x1 + 16, y + 12), "Proposed deductions", font=F(22, True), fill=ink)
    d.text((x2 - 16, y + 12), "Amount", font=F(22, True), fill=ink, anchor="ra")
    y += 48
    for desc, amt, _ in CHARGES:
        d.line((x1, y, x2, y), fill=(210, 210, 206), width=1)
        d.text((x1 + 16, y + 16), desc, font=F(22), fill=ink)
        d.text((x2 - 16, y + 16), "£%.2f" % amt, font=F(22), fill=ink, anchor="ra")
        y += 60
    d.line((x1, y, x2, y), fill=(120, 120, 116), width=2)
    total = sum(a for _, a, _ in CHARGES)
    d.text((x1 + 16, y + 16), "Total deductions", font=F(22, True), fill=ink)
    d.text((x2 - 16, y + 16), "£%.2f" % total, font=F(22, True), fill=ink, anchor="ra")
    y += 56
    d.text((x1 + 16, y + 12), "Balance to be returned", font=F(24, True), fill=(38, 92, 70))
    d.text((x2 - 16, y + 12), "£%.2f" % (1200 - total), font=F(24, True), fill=(38, 92, 70), anchor="ra")
    y += 100
    for ln in ["If you disagree with any of these deductions, please respond within 14 days of the date",
               "of this letter, setting out which charges you dispute and why. Any evidence, such as",
               "dated photographs from the start or end of the tenancy, is welcome."]:
        d.text((90, y), ln, font=F(22), fill=ink); y += 34
    y += 40
    d.text((90, y), "Yours sincerely,", font=F(22), fill=ink); y += 40
    d.text((90, y), "Elmfield Lettings, Deposits Team", font=F(22, True), fill=ink)
    d.text((W // 2, H - 60), "Sample letter for a staged demo. Fictional names and address.", font=F(17), fill=(120, 122, 128), anchor="mm")
    # scanned look: slight skew, paper grain
    im = im.rotate(0.25, resample=Image.BICUBIC, fillcolor=(244, 243, 240))
    im = add_noise(im, rng, 3).filter(ImageFilter.GaussianBlur(0.5))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PDF", resolution=150.0)


def build():
    ROOT.mkdir(parents=True, exist_ok=True)
    rng_master = random.Random(20261030)
    bases = {}
    for bid in SOURCES:
        im = load_base(bid)
        if bid == "carpet":
            im = add_stain(im, random.Random(11))
        bases[bid] = im
    photos, used_sides = [], {}
    for i, (bid, win, dt, truth, note, var) in enumerate(PLAN):
        rng = random.Random(1000 + i)
        im = bases[bid]
        if var == "reshot" or var == "wallmarks":
            side = (rng_master.randrange(4) + (1 if bid in used_sides else 0)) % 4
            used_sides[bid] = side
            im = reshot(im, rng, side)
            if var == "wallmarks":
                im = wall_marks(im, rng)
        elif var == "blurry":
            im = blurry(add_noise(im, rng))
        d = datetime.fromisoformat(dt)
        rel = "Photos/%04d/%02d/IMG_%s.jpg" % (d.year, d.month, d.strftime("%Y%m%d_%H%M%S"))
        save_jpeg(im, ROOT / rel, dt)
        s = SOURCES[bid]
        photos.append(dict(file=rel, window=win, datetime_original=dt, spot_truth=truth, state_note=note,
                           base_id=bid, source_page=s["source_page"], image_url=s["image_url"],
                           author=s["author"], license=s["license"]))
    render_letter(ROOT / "Documents/Tenancy/deduction-letter.pdf")
    manifest = dict(
        staged=True,
        note="STAGED DEMO: stock photos, programmatic re-shots and marks, assigned dates. Fictional names.",
        photos=photos,
        letter=dict(file="Documents/Tenancy/deduction-letter.pdf",
                    charges=[dict(description=a, amount_gbp=b, spot_truth=c) for a, b, c in CHARGES]),
        windows=WINDOWS,
        skipped=["moving-boxes photo (no suitable free-licence stock photo found)"],
    )
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    write_credits()
    print("wrote %d photos, letter, manifest, CREDITS.md under %s" % (len(photos), ROOT))


def write_credits():
    lines = ["# Credits and staging statement", "",
             "**This apartment is staged.** Every photo in `Photos/` is a free-licence stock photo (Wikimedia Commons; "
             "originals published under CC0 or CC BY-SA). The move-out photos are programmatic re-shots of the same base photo "
             "(small crop, rotation, colour shift, noise); stains, nail holes, scuffs and blur are added by `tools/make_fixture.py`; "
             "EXIF dates are assigned, not real. The deduction letter and all names and addresses are fictional. "
             "Derived images are modified versions and are shared under the same licences as their sources.", "",
             "## Source photos", ""]
    for bid, s in SOURCES.items():
        lines.append("- **%s**: %s, by %s, licence %s. [Source page](%s), [image](%s)." % (
            bid, s["source_page"].rsplit("File:", 1)[1].replace("_", " "), s["author"], s["license"], s["source_page"], s["image_url"]))
    lines += ["", "Used crops of the originals; the Ravak bathtub image (CC BY-SA 4.0) requires attribution to its author and "
              "share-alike for derivatives. No moving-boxes photo is included.", ""]
    (ROOT / "CREDITS.md").write_text("\n".join(lines))


def check():
    errs = []
    mp = ROOT / "manifest.json"
    if not mp.exists():
        print("FAIL: manifest.json missing"); return 1
    m = json.loads(mp.read_text())
    for p in m["photos"]:
        f = ROOT / p["file"]
        if not f.exists():
            errs.append("missing photo " + p["file"]); continue
        try:
            ex = Image.open(f).getexif()
            got = ex.get_ifd(0x8769).get(0x9003)
        except Exception as e:
            errs.append("unreadable %s: %s" % (p["file"], e)); continue
        want = datetime.fromisoformat(p["datetime_original"]).strftime("%Y:%m:%d %H:%M:%S")
        if got != want:
            errs.append("%s DateTimeOriginal %r != manifest %r" % (p["file"], got, want))
        if ex.get(0x0131) != SOFTWARE:
            errs.append(p["file"] + " missing Software tag")
    mi = m["windows"]["move_in"]
    for p in m["photos"]:
        if p["window"] == "move-in":
            if p["spot_truth"] == "bathroom-tub":
                errs.append("move-in window has a bathroom-tub photo: " + p["file"])
            if not (mi["start"] <= p["datetime_original"][:10] <= mi["end"]):
                errs.append("move-in photo outside window: " + p["file"])
    if not any(p["window"] == "move-out" and p["spot_truth"] == "bathroom-tub" for p in m["photos"]):
        errs.append("no move-out bathroom-tub photo")
    lf = ROOT / m["letter"]["file"]
    if not lf.exists() or lf.read_bytes()[:4] != b"%PDF":
        errs.append("letter PDF missing or invalid")
    tot = round(sum(c["amount_gbp"] for c in m["letter"]["charges"]), 2)
    if len(m["letter"]["charges"]) != 4 or tot != 420.00:
        errs.append("charges do not sum to 420.00 (got %s)" % tot)
    for e in errs:
        print("FAIL:", e)
    if errs:
        return 1
    print("OK: %d photos, EXIF dates match, no move-in bathroom-tub, letter present, charges sum to GBP %.2f" % (len(m["photos"]), tot))
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    build()
