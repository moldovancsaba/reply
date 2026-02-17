-- AppleScript to extract contact details from macOS Contacts app.
-- Run via: osascript chat/export-contacts.applescript
tell application "Contacts"
    if not running then
        launch
        delay 1
    end if
    set contactList to ""
    set allPeople to people
    repeat with p in allPeople
        set firstN to (first name of p)
        if firstN is missing value then set firstN to ""
        set lastN to (last name of p)
        if lastN is missing value then set lastN to ""
        
        set fullName to (name of p)
        
        -- Get Emails
        set emailList to {}
        repeat with e in (emails of p)
            copy (value of e) to end of emailList
        end repeat
        
        -- Get Phones
        set phoneList to {}
        repeat with ph in (phones of p)
            copy (value of ph) to end of phoneList
        end repeat
        
        -- Get Note
        set theNote to (note of p)
        if theNote is missing value then set theNote to ""
        
        -- Sanitize Note (Replace newlines with placeholder [NL])
        set {TID, AppleScript's text item delimiters} to {AppleScript's text item delimiters, {return, linefeed, rotation}}
        set noteLines to text items of theNote
        set AppleScript's text item delimiters to "[NL]"
        set theNote to noteLines as text
        set AppleScript's text item delimiters to TID
        
        -- Get Job Title
        set theJob to (job title of p)
        if theJob is missing value then set theJob to ""
        
        -- Format as pseudo-CSV for easy parsing
        set contactList to contactList & fullName & "|SEP|" & (emailList as string) & "|SEP|" & (phoneList as string) & "|SEP|" & theJob & "|SEP|" & theNote & "\n"
    end repeat
    return contactList
end tell
