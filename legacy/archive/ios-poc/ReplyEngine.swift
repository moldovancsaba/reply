//
//  ReplyEngine.swift
//  Reply
//
//  Created by Chihiro on 2026-02-16.
//

import Foundation

class ReplyEngine {
    private let rules: [String: String] = [
        "hello": "Hi there! How can I help you?",
        "hi": "Hello! What's up?",
        "how are you": "I'm doing well, thanks for asking!",
        "thanks": "You're welcome!",
        "bye": "Goodbye! Have a great day!",
        "yes": "Great!",
        "no": "Okay, noted.",
        "what": "I'm not sure, can you clarify?",
        "when": "Let me check the schedule.",
        "where": "Location details coming soon."
    ]
    
    func generateReply(for message: String) -> String {
        let lowerMessage = message.lowercased()
        for (key, reply) in rules {
            if lowerMessage.contains(key) {
                return reply
            }
        }
        return "Thanks for your message. I'll get back to you soon."
    }
}