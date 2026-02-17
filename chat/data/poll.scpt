
tell application "Messages"
    set out to ""
    repeat with c in chats
        try
            set ms to (messages of c whose date comes after ((current date) - 310))
            repeat with m in ms
                set isMe to (from me of m) as string
                set out to out & (id of m) & "|SEP|" & (contents of m) & "|SEP|" & (handle of participant 1 of c) & "|SEP|" & isMe & "|SEP|" & (date of m) & "\n"
            end repeat
        end try
    end repeat
    return out
end tell
