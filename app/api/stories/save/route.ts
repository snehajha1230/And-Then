import { type NextRequest, NextResponse } from "next/server"
import { getDataFromToken } from "@/helpers/getDataFromToken"
import { connectDB } from "@/db/dbconfig"
import Story from "@/models/story.model"
import Room from "@/models/room.model"

export async function POST(request: NextRequest) {
  try {
    const userId = getDataFromToken(request)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { story } = await request.json()

    if (!story) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    await connectDB()

    // Check if this is a multiplayer story
    // If roomCode exists, it's always multiplayer (even if isMultiplayer flag is missing)
    const isMultiplayer = story.isMultiplayer || !!story.roomCode
    let roomCode: string | null = story.roomCode || null

    // If multiplayer, get roomCode if not provided
    if (isMultiplayer && !roomCode) {
      // Try to find room by storyId
      const storyId = story.id || story._id
      if (storyId) {
        const room = await Room.findOne({ storyId })
        if (room) {
          roomCode = room.roomCode
        }
      }
    }

    const basePayload = {
      title: story.title,
      genre: story.genre,
      content: story.content,
      choices: story.choices,
      currentChoiceIndex: story.currentChoiceIndex,
      personalityTraits: story.personalityTraits,
      character: story.character,
      isStoryComplete: story.isStoryComplete ?? false,
      choiceHistory: story.choiceHistory ?? [],
      isMultiplayer: isMultiplayer || false,
      roomCode: roomCode,
      savedAt: new Date(),
    }

    const storyId: string | undefined = story.id || story._id

    // If multiplayer, save only for the current user (not all users)
    // This allows each user to save their own copy and rejoin later
    if (isMultiplayer) {
      const userPayload = { ...basePayload, userId, isMultiplayer: true } // Ensure isMultiplayer is always true
      
      // Try to find existing story for this user with same roomCode
      let doc
      if (roomCode) {
        // Find by roomCode (more reliable than isMultiplayer flag alone)
        const existing = await Story.findOne({
          userId: userId,
          roomCode: roomCode,
        })
        
        if (existing) {
          // Update existing story, ensuring isMultiplayer is set to true
          doc = await Story.findOneAndUpdate(
            { _id: existing._id, userId: userId },
            userPayload,
            { new: true }
          )
        } else {
          doc = await Story.create(userPayload)
        }
      } else {
        // If no roomCode, create new story
        doc = await Story.create(userPayload)
      }

      return NextResponse.json(
        {
          message: "Story saved to your multiplayer library",
          story: doc,
        },
        { status: 200 },
      )
    }

    // Single player story - save normally
    // Ensure isMultiplayer is explicitly false for single player stories
    const singlePlayerPayload = { ...basePayload, isMultiplayer: false, roomCode: null, userId }
    let doc
    if (storyId) {
      doc = await Story.findOneAndUpdate(
        { _id: storyId, userId, isMultiplayer: { $ne: true } }, // Only update if not multiplayer
        singlePlayerPayload,
        {
          new: true,
        }
      )

      if (!doc) {
        // If not found for this user/id, create a fresh one
        doc = await Story.create(singlePlayerPayload)
      }
    } else {
      doc = await Story.create(singlePlayerPayload)
    }

    return NextResponse.json(
      {
        message: "Story saved",
        story: doc,
      },
      { status: storyId ? 200 : 201 },
    )
  } catch (error) {
    console.error("Save story error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
