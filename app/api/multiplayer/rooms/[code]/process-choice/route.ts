import { NextRequest, NextResponse } from "next/server"
import { getDataFromToken } from "@/helpers/getDataFromToken"
import { connectDB } from "@/db/dbconfig"
import Room from "@/models/room.model"
import Story from "@/models/story.model"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const userId = getDataFromToken(request)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { code } = await params
    const roomCode = code.toUpperCase()

    const body = await request.json().catch(() => ({}))
    const { selectedChoiceId } = body

    await connectDB()

    const room = await Room.findOne({ roomCode })

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    if (room.status !== "playing") {
      return NextResponse.json({ error: "Room is not in playing phase" }, { status: 400 })
    }

    // Check if user is host
    if (room.hostId.toString() !== userId) {
      return NextResponse.json({ error: "Only the host can process choices" }, { status: 403 })
    }

    if (!room.storyId) {
      return NextResponse.json({ error: "No story associated with room" }, { status: 400 })
    }

    // Get current story
    const story = await Story.findById(room.storyId)
    if (!story) {
      return NextResponse.json({ error: "Story not found" }, { status: 404 })
    }

    // Determine winning choice from votes
    if (!room.choiceVotes || room.choiceVotes.size === 0) {
      return NextResponse.json({ error: "No votes recorded" }, { status: 400 })
    }

    // Check if we're in tie-breaker mode (re-voting on tied choices)
    const isTieBreakerMode = room.tiedChoicesForVoting && room.tiedChoicesForVoting.length > 0

    // Check if all participants have voted
    // IMPORTANT: Include host in total count if host is active and not in participants array
    // This matches the frontend logic for calculating totalPlayers
    const hostIdString = room.hostId.toString()
    const hostInParticipants = room.participants.some((p: any) => {
      const pId = typeof p === "object" && p._id ? p._id.toString() : p.toString()
      return pId === hostIdString
    })
    // Total players = participants + host (if host is active and not already in participants)
    const totalParticipants = room.participants.length + (room.hostActive !== false && !hostInParticipants ? 1 : 0)
    const uniqueVoters = new Set<string>()
    
    // If in tie-breaker mode, only count votes for tied choices
    const choicesToCount = isTieBreakerMode ? room.tiedChoicesForVoting : Array.from(room.choiceVotes.keys())
    
    choicesToCount.forEach((choiceId: string) => {
      const userIds = room.choiceVotes.get(choiceId) || []
      userIds.forEach((id: any) => uniqueVoters.add(id.toString()))
    })

    // Only allow processing if all participants have voted (unless host is manually breaking a tie)
    if (!selectedChoiceId && uniqueVoters.size < totalParticipants) {
      return NextResponse.json({
        error: "All participants must vote before processing",
        participants: totalParticipants,
        voters: uniqueVoters.size,
        isTieBreakerMode,
      }, { status: 400 })
    }

    let maxVotes = 0
    let winningChoiceId: string | null = null
    const choiceVoteCounts: Array<{ choiceId: string; votes: number }> = []

    choicesToCount.forEach((choiceId: string) => {
      const userIds = room.choiceVotes.get(choiceId) || []
      const voteCount = userIds.length
      if (voteCount > 0) {
        choiceVoteCounts.push({ choiceId, votes: voteCount })
        if (voteCount > maxVotes) {
          maxVotes = voteCount
          winningChoiceId = choiceId
        }
      }
    })

    // Check for ties
    const tiedChoices = choiceVoteCounts.filter((c) => c.votes === maxVotes && c.votes > 0)
    const tiedChoiceIds = tiedChoices.map((c) => c.choiceId)

    // If there's a tie and we're NOT in tie-breaker mode, initiate tie-breaker voting
    if (tiedChoices.length > 1 && !isTieBreakerMode && !selectedChoiceId) {
      // Set tied choices for re-voting and clear votes for non-tied choices
      room.tiedChoicesForVoting = tiedChoiceIds
      // Clear votes for choices that are not tied
      const allChoiceIds = Array.from(room.choiceVotes.keys())
      allChoiceIds.forEach((choiceId: string) => {
        if (!tiedChoiceIds.includes(choiceId)) {
          room.choiceVotes.delete(choiceId)
        }
      })
      // Clear all votes for tied choices to start fresh voting
      tiedChoiceIds.forEach((choiceId: string) => {
        room.choiceVotes.delete(choiceId)
      })
      await room.save()
      
      return NextResponse.json({
        hasTie: true,
        tiedChoices: tiedChoiceIds,
        isTieBreakerVoting: true,
        message: "Tie detected. All players will vote again on the tied choices.",
      })
    }

    // If there's a tie AFTER tie-breaker voting and no selectedChoiceId, require host selection
    if (tiedChoices.length > 1 && isTieBreakerMode && !selectedChoiceId) {
      return NextResponse.json({
        hasTie: true,
        tiedChoices: tiedChoiceIds,
        isTieBreakerVoting: true,
        requiresHostSelection: true,
        message: "Tie persists after re-voting. Host must select the final choice.",
      })
    }

    // If selectedChoiceId is provided (host breaking tie), use it
    if (selectedChoiceId) {
      // Validate that the selected choice is one of the tied choices
      const validChoices = isTieBreakerMode ? room.tiedChoicesForVoting : tiedChoiceIds
      if (!validChoices.includes(selectedChoiceId)) {
        return NextResponse.json({ error: "Selected choice is not one of the tied choices" }, { status: 400 })
      }
      winningChoiceId = selectedChoiceId
    } else if (tiedChoices.length === 1) {
      // No tie, use the winning choice
      winningChoiceId = tiedChoices[0].choiceId
    }

    if (!winningChoiceId) {
      return NextResponse.json({ error: "Could not determine winning choice" }, { status: 400 })
    }

    // Find the winning choice in the story
    const winningChoice = story.choices.find((c: any) => c.id === winningChoiceId)
    if (!winningChoice) {
      return NextResponse.json({ error: "Winning choice not found in story" }, { status: 400 })
    }

    // Set processing flag so all participants see the loader
    // Clear previous evaluation while processing
    room.isProcessing = true
    room.lastChoiceEvaluation = { quality: null, message: null }
    await room.save()

    // Generate next part of story
    // For server-side API routes, we need to use the full URL
    const host = request.headers.get('host') || 'localhost:3000'
    const protocol = request.headers.get('x-forwarded-proto') || 'http'
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${protocol}://${host}`
    
    const generateResponse = await fetch(`${baseUrl}/api/stories/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        genreId: story.genre,
        personalityTraits: Object.fromEntries(story.personalityTraits || new Map()),
        // No character for multiplayer - use second person "you"
        previousContent: story.content,
        lastChoice: {
          id: winningChoice.id,
          text: winningChoice.text,
        },
        choiceHistory: story.choiceHistory || [],
        isMultiplayer: true, // Flag for second-person narrative
      }),
    })

    if (!generateResponse.ok) {
      room.isProcessing = false
      await room.save()
      throw new Error("Failed to generate next part")
    }

    const storyData = await generateResponse.json()

    // Update story
    story.content = storyData.content
    story.choices = storyData.choices
    story.currentChoiceIndex = story.currentChoiceIndex + 1
    story.isStoryComplete = storyData.isStoryComplete ?? story.isStoryComplete
    story.choiceHistory = [
      ...(story.choiceHistory || []),
      {
        segmentIndex: story.currentChoiceIndex - 1,
        choiceId: winningChoice.id,
        quality: storyData.lastChoiceEvaluation?.quality,
      },
    ]

    await story.save()

    // Clear choice votes, tied choices, and update room
    room.choiceVotes = new Map()
    room.tiedChoicesForVoting = []
    room.currentChoiceIndex = story.currentChoiceIndex
    room.isProcessing = false // Processing complete
    // Store last choice evaluation for all participants to see
    if (storyData.lastChoiceEvaluation) {
      room.lastChoiceEvaluation = {
        quality: storyData.lastChoiceEvaluation.quality,
        message: storyData.lastChoiceEvaluation.message,
      }
    } else {
      room.lastChoiceEvaluation = { quality: null, message: null }
    }
    if (story.isStoryComplete) {
      room.status = "completed"
      
      // Save story for all participants and host with multiplayer tag and room code
      // Do this asynchronously so it doesn't block the response
      const allUsers = [
        room.hostId.toString(),
        ...room.participants.map((p: any) => p.toString()),
      ]
      // Remove duplicates
      const uniqueUsers = [...new Set(allUsers)]
      
      const storyPayload = {
        title: story.title,
        genre: story.genre,
        content: story.content,
        choices: story.choices,
        currentChoiceIndex: story.currentChoiceIndex,
        personalityTraits: story.personalityTraits || new Map(),
        character: story.character,
        isStoryComplete: story.isStoryComplete,
        choiceHistory: story.choiceHistory || [],
        isMultiplayer: true,
        roomCode: room.roomCode,
      }

      // Save for each user (fire and forget)
      Promise.all(
        uniqueUsers.map(async (userId: string) => {
          try {
            // Check if story already exists for this user with this roomCode
            const existing = await Story.findOne({
              userId: userId,
              roomCode: room.roomCode,
              isMultiplayer: true,
            })
            
            if (existing) {
              // Update existing story
              await Story.findOneAndUpdate(
                { _id: existing._id, userId: userId },
                { ...storyPayload, userId: userId, savedAt: new Date() }
              )
            } else {
              // Create new story
              await Story.create({
                userId: userId,
                ...storyPayload,
                savedAt: new Date(),
              })
            }
          } catch (error) {
            console.error(`Error saving story for user ${userId}:`, error)
          }
        })
      ).catch((error) => {
        console.error("Error saving stories for users:", error)
      })
    }
    await room.save()

    return NextResponse.json({
      message: "Choice processed",
      story: {
        content: story.content,
        choices: story.choices,
        currentChoiceIndex: story.currentChoiceIndex,
        isStoryComplete: story.isStoryComplete,
      },
      lastChoiceEvaluation: storyData.lastChoiceEvaluation,
      hasTie: false,
    })
  } catch (error) {
    console.error("Process choice error:", error)
    // Reset processing flag on error
    try {
      const room = await Room.findOne({ roomCode: code.toUpperCase() })
      if (room) {
        room.isProcessing = false
        await room.save()
      }
    } catch (saveError) {
      console.error("Error resetting processing flag:", saveError)
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

