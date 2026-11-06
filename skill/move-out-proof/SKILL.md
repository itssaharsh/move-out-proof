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

Search windows, stated back to the person before searching:

- Move-in window: from 14 days before to 30 days after the move-in date.
- Move-out window: from 14 days before to 7 days after the move-out date. In gap mode there is no move-out window.

# Generation-time capability evidence

- `ug-photo` → `photo-agent`
- `ug-document` → `document-agent`
- `ug-filesystem` → `file-agent`
- `ug-knowledge` → `knowledge-agent`

Actions this workflow relies on, all in the public capability catalog: `search-picture` with a start and end time, `meta` for capture time, `vision-vlm` on one image with a prompt, and `create-album` with chosen items (approval) from `ug-photo`; `extract` with the contract schema and `qa` from `ug-document`; `mkdir` and `cpmv` in copy mode (approval) from `ug-filesystem`; `save-text` (approval) from `ug-knowledge`.

# Workflow

Pass to each step only the real result the previous step returned: real file paths, real capture times, real charge lines. Never pass a guess downstream.

**Step 1. Find the photos in each window.**

`delegate --target photo-agent --instruction 'Search the photo library for images (not videos) whose capture time falls inside the move-in window confirmed with the person, and separately inside the move-out window if there is one. Use the location filter only if the person gave an address or city. For every photo return its file path and its capture time read from the photo metadata. Change nothing. If a window has no photos, return an empty list for that window and say so plainly.'`

- If either window returns no results, tell the person "No photos were found between" the two dates of that window, and stop. Do not widen the window or search other folders unless the person asks.
- If a window holds more than 80 photos, tell the person the count and ask (`waiting_user`) whether to label them all or narrow by folder or location first.

**Step 2. Name the spot in each photo.**

`delegate --target photo-agent --instruction 'For each photo path returned by the search step, run the vision model on that single image with this prompt: Which part of a rented home does this photo show? Answer on the first line with exactly one label from this list: kitchen-oven, kitchen-counter, kitchen-sink, fridge, bathroom-tub, bathroom-sink, toilet, living-room-wall, living-room-carpet, bedroom-wall, bedroom-carpet, window, front-door, not-a-spot, unclear. Use unclear when the photo is too dark or too blurry to tell. On the second line write one sentence about visible dirt, stains, marks or damage, or write none visible. Return the path, the capture time from the search step, the label and the sentence for every photo. Do not guess a label for a photo you cannot read.'`

**Step 3. Build the pairs (no delegation).**

- Group photos by label. For each spot, the move-in photo is the earliest photo of that spot in the move-in window, and the move-out photo is the latest photo of that spot in the move-out window.
- Dates are copied from the capture times of Step 1, never from the vision answer.
- Photos labelled `unclear` go to an Unclear list with their path and date. Photos labelled `not-a-spot` are counted and left out.
- A spot with a photo on one side only is a gap: write "No dated move-in photo of this spot" or "No dated move-out photo of this spot". Never pair photos of two different spots.

**Gap mode ends here.** Show a table of every spot found, with a mark for each side, then the spots with no dated move-in photo, and suggest photographing them now and looking for older photos of them. Save nothing unless the person asks; if they ask, save the table through Step 7c after approval.

**Step 4. Read the charges on the letter (letter mode).**

If the person did not name the letter file:

`delegate --target document-agent --instruction 'Find documents the person can access whose content is a letter about the return of a tenancy deposit or proposed deposit deductions, and list each candidate with its file path, date and sender. Change nothing. If none is found, return an empty result and say so.'`

Ask the person to confirm one candidate (`waiting_user`). If there is no candidate, say so and offer gap mode.

`delegate --target document-agent --instruction 'From the deposit deduction letter the person confirmed, extract every proposed deduction using the contract schema with full content scope. For each line return the description exactly as written, the amount with its currency, and any room or item it names. Also return the deposit amount, the total of deductions, the letter date and any deadline for the tenant to respond. If no deduction line can be read, return an empty result and say so.'`

If the letter yields no deduction lines, say so, stop letter mode and offer gap mode.

**Step 5. Match each charge to one spot (no delegation).**

- Map each charge to one label from [the spot list](references/spots.md) by the room or item it names, for example "Oven deep clean" to `kitchen-oven` and "Carpet stain treatment, living room" to `living-room-carpet`.
- A charge that names no spot (an admin fee, rent arrears) is shown as "No photo spot" and keeps its amount in the totals.
- When a charge could belong to two spots, ask the person which one (`waiting_user`). Never choose for them.
- For each charge, the row holds: the move-in photo with its capture date and visible note, or the gap sentence; the move-out photo with its capture date and visible note, or the gap sentence. No verdicts.

**Step 6. Ask for approval before any write.**

Show the person, in one message: the windows used; the charge rows; the exact list of photos that will go into the album and the folder; the album name `Move-out Proof deposit evidence`; the folder `Deposit_Evidence` inside the folder that holds the letter; the report file name `move-out-proof-report`. Wait for approval (`waiting_approval`). If the person declines, treat it as `cancelled` and create nothing.

**Step 7. Create the evidence pack, only after approval.**

7a. `delegate --target photo-agent --instruction 'Create an album named Move-out Proof deposit evidence containing exactly the photo paths the person approved, in pair order, each move-in photo followed by its move-out photo. Create nothing else. Return the album identifier and the number of photos added.'`

7b. `delegate --target file-agent --instruction 'Create a folder named Deposit_Evidence inside the folder that holds the deposit deduction letter the person confirmed. Copy each photo the person approved into that folder in copy mode, leaving every original file in place, and never overwrite an existing file. Return the folder path and the list of copied files.'`

7c. `delegate --target knowledge-agent --instruction 'Save the report text the person approved, exactly as approved, as a Markdown file named move-out-proof-report inside the Deposit_Evidence folder returned by the file step. Return the saved file path and its size.'`

If 7a or 7b fails, do not run 7c; report what was created and what was not.

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
