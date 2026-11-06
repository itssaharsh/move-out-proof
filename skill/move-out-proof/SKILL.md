---
name: move-out-proof
description: Dated move-in and move-out photo pairs for every charge on a rental deposit deduction letter, built from the renter's own photo library on the NAS, plus the list of spots in the home that still have no dated move-in photo. Use when a renter is moving out, has received a deposit deduction letter, wants to answer a cleaning or damage charge, or asks which parts of the flat have no move-in photo yet.
---

# Goal

Help a renter answer a deposit deduction letter with photos they already own. For each spot in the home (the oven, a carpet, a wall, the bathtub), find the photo taken around move-in and the photo taken around move-out, and place the two beside the charge that concerns that spot.

Two entry points, one workflow:

- **Letter mode.** The renter has a deduction letter. Result: an album of dated photo pairs, a `Deposit_Evidence` folder next to the letter, and a charge-by-charge report.
- **Gap mode.** The renter has not handed back the keys yet. Result: the list of spots with no dated move-in photo, so they know what to photograph and which older photos to look for before moving out.

The rule of this Skill: the vision model only names the spot and describes what is visible; every date comes from the photo metadata; the renter decides what to dispute. The Skill gives no legal advice and never says whether a charge is fair.

Scope: photos and documents the person can already access on this NAS. Nothing is sent, shared, deleted or moved. Every write (album, folder, copies, report) happens only after the person approves the exact list.

Read [the spot list](references/spots.md) before labelling photos, [the report format](references/report-format.md) before writing the report, and [the guide](references/guide.md) when the person asks how the Skill works.

# Required input

Collect only these, in one short question if several are missing:

1. **Move-in date** (a day or a month) and **move-out date** (a day, or "not yet" for gap mode). If either is missing, ask once and wait (`waiting_user`) before any search.
2. **The deduction letter** (letter mode only): the file name or folder the person names. If they do not know where it is, the document step below finds candidate letters and the person confirms one.
3. Optional: the address or city of the home, used only to narrow the photo search when photos carry a location.

Search windows (tell the person which windows you are using in the same message as your first search, then continue without waiting for a reply):

- Move-in window: from 14 days before to 30 days after the move-in date.
- Move-out window: from 14 days before to 7 days after the move-out date. In gap mode there is no move-out window.

# Generation-time capability evidence

- `ug-photo` → `photo-agent`
- `ug-document` → `document-agent`
- `ug-filesystem` → `file-agent`
- `ug-knowledge` → `knowledge-agent`

Actions this workflow relies on, all in the public capability catalog: `search-picture` with a start and end time, `meta` for capture time, `vision-vlm` on one image with a prompt, `vision-ocr` for a letter saved as a picture, and `create-album` with chosen items (approval) from `ug-photo`; `extract` with the contract schema and `qa` from `ug-document`; `mkdir` and `cpmv` in copy mode (approval) from `ug-filesystem`; `save-text` (approval) from `ug-knowledge`.

# Workflow

Pass to each step only the real result the previous step returned: real photo identifiers and file paths, real capture times, real charge lines. Never pass a guess downstream.

**Step 1. Find the photos in each window.**

1a. Move-in window first:

`delegate --target photo-agent --instruction 'Search the photo library for images (not videos and not screenshots) whose capture time falls inside the move-in window confirmed with the person. If the library search offers scene or object filters, use them to keep only photos of the inside of a home (rooms, walls, floors, kitchen, bathroom, fixtures) and say how many were left out; do not run the vision model in this step. Use the location filter only if the person gave an address or city. For every photo return its photo identifier and file path as the library gives them, and its capture time read from the photo metadata. List photos with no capture time separately as undated. Change nothing. If there are no photos, return an empty list and say so plainly.'`

- If the move-in window returns no results, tell the person "No photos were found between" the two dates of that window, and stop. Do not search the move-out window, widen the window or search other folders unless the person asks.

1b. Then the move-out window (letter mode only), with the same instruction for the move-out window:

`delegate --target photo-agent --instruction 'Search the photo library for images (not videos and not screenshots) whose capture time falls inside the move-out window confirmed with the person. If the library search offers scene or object filters, use them to keep only photos of the inside of a home (rooms, walls, floors, kitchen, bathroom, fixtures) and say how many were left out; do not run the vision model in this step. Use the location filter only if the person gave an address or city. For every photo return its photo identifier and file path as the library gives them, and its capture time read from the photo metadata. List photos with no capture time separately as undated. Change nothing. If there are no photos, return an empty list and say so plainly.'`

- If the move-out window returns no results, say "No photos were found between" its two dates; the report can still show the move-in side, so ask the person whether to continue with move-in photos only (`waiting_user`).
- If a window still holds more than 40 photos, label first the 40 captured closest to the move-in date (or, for the move-out window, the move-out date), tell the person how many were not labelled, and offer to label the rest afterwards.
- Undated photos are never used as dated photos; mention how many there were.

**Step 2. Name the spot in each photo.**

`delegate --target photo-agent --instruction 'For each photo returned by the search step (at most 40 per window, as selected above), run the vision model on that single image with this prompt: Which part of a rented home does this photo show? Answer on the first line with exactly one label for the main subject, from this list: kitchen-oven, kitchen-counter, kitchen-sink, fridge, bathroom-tub, bathroom-sink, toilet, living-room-wall, living-room-carpet, bedroom-wall, bedroom-carpet, window, front-door, not-a-spot, unclear. Use unclear when the photo is too dark or too blurry to tell. On the second line list any other labels from the same list that are also clearly visible, separated by commas, or write none. On the third line write one sentence about visible dirt, stains, marks or damage, or write none visible. Return the photo identifier, the path, the capture time from the search step, the main label, the other visible labels and the sentence for every photo. Do not guess a label for a photo you cannot read.'`

**Step 3. Build the pairs (no delegation).**

- Group photos by main label. For each spot, the move-in photo is the earliest photo with that main label in the move-in window, and the move-out photo is the latest photo with that main label in the move-out window.
- Wider shots: if one side of a spot has no photo with that main label, use a photo from that window that lists the spot among its other visible labels, and mark it "wider shot" so the person knows the spot is in frame but not the subject.
- Dates are copied from the capture times of Step 1, never from the vision answer.
- Photos labelled `unclear` go to an Unclear list with their path and date. Photos labelled `not-a-spot` are counted and left out.
- A spot with no photo on one side, even in a wider shot, is a gap: write "No dated move-in photo of this spot" or "No dated move-out photo of this spot". Never pair photos of two different spots.

**Gap mode ends here.** Show two lists: the spots that have a dated move-in photo (with file name and date), and every label from [the spot list](references/spots.md) that has none. Ask the person to photograph the missing spots that exist in their home before handing back the keys, and to look for older photos of them. Save nothing unless the person asks; if they ask, save the lists through Step 7c after approval.

**Step 4. Read the charges on the letter (letter mode).**

If the person did not name the letter file:

`delegate --target document-agent --instruction 'Find documents the person can access whose content is a letter about the return of a tenancy deposit or proposed deposit deductions, and list each candidate with its file path, date and sender. Change nothing. If none is found, return an empty result and say so.'`

Ask the person to confirm one candidate (`waiting_user`). If there is no candidate, say so and offer gap mode.

`delegate --target document-agent --instruction 'From the deposit deduction letter the person confirmed, extract every proposed deduction using the contract schema with full content scope. For each line return the description exactly as written, the amount with its currency, and any room or item it names. Also return the deposit amount, the total of deductions, the letter date and any deadline for the tenant to respond. If no deduction line can be read, return an empty result and say so.'`

If the confirmed letter is a picture (a photo or a scan saved as an image) and the extraction returns no lines, read it with text recognition instead:

`delegate --target photo-agent --instruction 'Run text recognition on the picture of the deposit deduction letter the person confirmed and return the full recognised text exactly as read, line by line. Change nothing. If no text can be read, return an empty result and say so.'`

Then take each deduction line, amount, the deposit, the total and the deadline from that returned text, copying each value exactly as it appears.

- Check that the amounts add up to the total printed on the letter, and to any amount the person mentioned. If they do not, show both figures and ask the person (`waiting_user`) before going on.
- If the letter yields no deduction lines at all, say so, stop letter mode and offer gap mode.

**Step 5. Match each charge to one spot (no delegation).**

- Map each charge to one label from [the spot list](references/spots.md) by the room or item it names, for example "Oven deep clean" to `kitchen-oven` and "Carpet stain treatment, living room" to `living-room-carpet`.
- Use the "Charges it usually answers" column of the spot list: a charge that names a room or an item covered there maps to that spot even when its wording differs (a bathroom cleaning charge maps to `bathroom-tub`).
- A charge that names no spot at all (an admin fee, rent arrears) is shown as "No photo spot" and keeps its amount in the totals.
- When a charge could belong to two spots, ask the person which one (`waiting_user`). Never choose for them.
- For each charge, the row holds: the move-in photo with its capture date and visible note, or the gap sentence; the move-out photo with its capture date and visible note, or the gap sentence. No verdicts.

**Step 6. Ask for approval before any write.**

Show the person, in one message: the windows used; the charge rows; the exact list of photos that will go into the album; the album name `Move-out Proof deposit evidence`; the folder `Deposit_Evidence` inside the folder that holds the letter; the report file name `move-out-proof-report`. Ask whether they also want copies of the paired photos in that folder (useful for attaching to an email). Tell them the NAS may ask them to confirm each write again, including each copy; that is expected. Wait for approval (`waiting_approval`). If the person declines, treat it as `cancelled` and create nothing.

**Step 7. Create the evidence pack, only after approval.**

7a. `delegate --target photo-agent --instruction 'Create an album named Move-out Proof deposit evidence containing exactly the photos the person approved, identified by the photo identifiers (or, where none was given, the file paths) returned by the search step, in pair order, each move-in photo followed by its move-out photo. Create nothing else. Return the album identifier and the number of photos added.'`

7b. `delegate --target file-agent --instruction 'Create a folder named Deposit_Evidence inside the folder that holds the deposit deduction letter the person confirmed. Create only this folder: do not move, copy or change any file in this step. Return the folder path.'`

If the person asked for copies, also:

`delegate --target file-agent --instruction 'Copy each photo the person approved, and only those photos (not the letter and no other file), into the Deposit_Evidence folder returned by the previous file step, in copy mode, leaving every original file in place and never overwriting an existing file. Return the list of copied files and any that could not be copied.'`

7c. `delegate --target knowledge-agent --instruction 'Save the report the person approved as a Markdown file named move-out-proof-report inside the Deposit_Evidence folder returned by the file step; if that folder cannot be used, save it in the default location and return where it was saved. The report is the text between the line BEGIN REPORT and the line END REPORT at the end of this instruction: save exactly that text and nothing else. Return the saved file path and its size.'`

When composing 7c, write the approved report, formatted as in [the report format](references/report-format.md), after the instruction, between a line BEGIN REPORT and a line END REPORT.

If the folder step fails, do not run the copy or the report steps; report what was created and what was not, using the real locations the experts returned.

# Completion and failure

Handle every delegation state explicitly:

- `completed`: use only the real result the expert returned, and pass only those real paths, dates and charge lines downstream.
- `waiting_user`: put the expert's question to the person in plain words, then resume the same step with their answer.
- `waiting_approval`: show exactly what will be created and wait. On approval continue; on refusal treat the step as `cancelled`.
- `cancelled`: stop. Say that nothing was created, or list exactly what had already been created before the cancel.
- `failed`: say which step failed and what was not done, and stop every step that depends on it. Never fill in photos, dates or charges from memory.

Empty and partial results:

- No results in a window: say "No photos were found between" its two dates and stop. Do not substitute photos from other dates or folders.
- No deduction lines in the letter: say so and offer gap mode.
- Partial results are kept and shown: spots with one side missing, unclear photos, charges with no photo spot, and any photo the vision step could not read.

Final message, in this order: the windows used; how many photos were searched, labelled, unclear and left out; how many charges have both dated photos, one, or none; where the album, the folder and the report are (only those that were really created); and the reminder that the renter decides what to dispute. Report a write as done only after its expert returned `completed`.
