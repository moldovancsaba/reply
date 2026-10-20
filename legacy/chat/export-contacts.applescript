-- AppleScript to extract contact details from macOS Contacts app.
-- Run via: osascript chat/export-contacts.applescript
tell application "Contacts"
    if not running then
        launch
        delay 1
    end if
    set contactData to {}
    set allPeople to people
    repeat with p in allPeople
        set fullName to (name of p)
        if fullName is missing value then set fullName to ""
        
        -- Get Emails
        set {TID, AppleScript's text item delimiters} to {AppleScript's text item delimiters, ","}
        set emailList to (value of emails of p) as string
        set AppleScript's text item delimiters to TID
        
        -- Get Phones
        set {TID, AppleScript's text item delimiters} to {AppleScript's text item delimiters, ","}
        set phoneList to (value of phones of p) as string
        set AppleScript's text item delimiters to TID
        
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
        -- Get Organization
        set theOrg to (organization of p)
        if theOrg is missing value then set theOrg to ""
        
        -- Get LinkedIn URL
        set linkedInUrl to ""
        repeat with u in (urls of p)
            if (value of u) contains "linkedin.com" then
                set linkedInUrl to (value of u)
                exit repeat
            end if
        end repeat
        
        -- Format as pseudo-CSV for easy parsing
        set end of contactData to fullName & "|SEP|" & emailList & "|SEP|" & phoneList & "|SEP|" & theJob & "|SEP|" & theNote & "|SEP|" & theOrg & "|SEP|" & linkedInUrl
    end repeat
    
    set {TID, AppleScript's text item delimiters} to {AppleScript's text item delimiters, "\n"}
    set output to contactData as text
    set AppleScript's text item delimiters to TID
    return output
end tell
