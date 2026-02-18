//
//  ContentView.swift
//  Reply
//
//  Created by Chihiro on 2026-02-16.
//

import SwiftUI

struct ContentView: View {
    @State private var inputMessage = ""
    @State private var generatedReply = ""
    private let replyEngine = ReplyEngine()
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Reply Machine")
                .font(.largeTitle)
                .padding()
            Text("Automatic message replying app")
                .font(.subheadline)
                .foregroundColor(.secondary)
            
            TextField("Enter a message", text: $inputMessage)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            Button("Generate Reply") {
                generatedReply = replyEngine.generateReply(for: inputMessage)
            }
            .buttonStyle(.borderedProminent)
            
            if !generatedReply.isEmpty {
                Text("Reply: \(generatedReply)")
                    .padding()
                    .background(Color.blue.opacity(0.1))
                    .cornerRadius(8)
            }
            
            Spacer()
        }
        .frame(minWidth: 400, minHeight: 300)
        .padding()
    }
}

#Preview {
    ContentView()
}