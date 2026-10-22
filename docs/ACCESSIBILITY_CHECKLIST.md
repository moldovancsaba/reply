# Accessibility check by a person

Status: living document. About 30 minutes. The automated gate (axe, keyboard order, contrast in light, dark and at 375 px, in Chrome and WebKit) cannot judge what a screen reader says or how the page looks in forced colors and at 200% zoom. This list covers those, in the order of the screens. Record each result in [issue #259](https://github.com/moldovancsaba/reply/issues/259): **OK**, or what you heard or saw.

Setup: open Reply Core in Safari. VoiceOver on and off with Command+F5. VoiceOver keys: Control+Option is the "VO" key; VO+Right moves to the next item, VO+Space presses, VO+U opens the rotor (headings, landmarks, links, buttons).

## A. VoiceOver

| # | Where | Do | Expect to hear |
|---|---|---|---|
| 1 | Any page | VO+U, Landmarks | banner, navigation "Reply Core", main; the first Tab stop is "Skip to content" and it moves you into the page |
| 2 | Inbox | Move through the list | each conversation is one link read as: name, last message, channel, time, counts ("3 iMessage messages"); a "N new" badge is read with it |
| 3 | Inbox | Type in "Search names"; press a channel button | the result count is announced ("Showing 3 of 16 conversations"); the active channel is identifiable (say what you hear) |
| 4 | A conversation | VO+U, Headings | the name as a heading; the messages as a log; each message says who, channel and time; day headings |
| 5 | A conversation | Scroll up, wait for a new message (or send one) | a "1 new message" button is announced politely, and pressing it moves to the newest |
| 6 | Reply box | Move through it | "Send through" radio group, Address, Message (with the character count), Attach files, Send; a failed send is read as an alert and focus moves to it |
| 7 | Send | Press Send | the dialog is announced with its title "Send this message?", focus stays inside it, Escape closes it and focus returns to the Send button |
| 8 | Profile | Open it (column, or the Profile link) | sections have headings (Address book, How to reach them, Activity, Notes, Merge); the photo is not announced (decorative) |
| 9 | Profile > Merge | Review a suggestion, open the merge dialog | the suggestion list is announced ("Suggested duplicates"); the dialog says what moves; Cancel and Merge are reachable by keyboard |
| 10 | Sources | Move through it | each source reads: name, state badge ("Connected" / "Needs your attention"), message, counts; Allow buttons are named; "Imported N messages so far" updates politely while syncing |

## B. Forced colors and increased contrast

System Settings > Accessibility > Display: switch on **Increase contrast** (and, if you use it, **Reduce transparency**). Reload.

| # | Where | Expect |
|---|---|---|
| 11 | Inbox, a conversation, Sources | text readable, the selected conversation and the sent/received bubbles still distinguishable (not by colour alone), badges and buttons keep a visible border, focus ring visible on every control |

## C. 200% zoom and large text

Safari > View > Zoom In until 200% (Command+plus, 4 times), window about 1280 px wide.

| # | Where | Expect |
|---|---|---|
| 12 | Inbox and a conversation | no horizontal scrolling of the page, nothing cut off or overlapping, the Reply box and the Send button reachable; at 200% the layout switches to one pane at a time with "Back to conversations" |

## How to report

For each failure give: number, what you heard or saw, and the screen. One comment on #259 with the list is enough. A pass of all twelve closes the issue; failures become their own issues with the number from this list.
