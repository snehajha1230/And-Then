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
    const isMultiplayer = story.isMultiplayer || story.roomCode
    let roomCode: string | null = story.roomCode || null
    let allUsers: string[] = [userId] // Default to just the current user

    // If multiplayer, get room and all participants
    if (isMultiplayer) {
      // Try to find room by roomCode if provided
      if (roomCode) {
        const room = await Room.findOne({ roomCode: roomCode.toUpperCase() })
        if (room) {
          // Include host and all participants
          allUsers = [
            room.hostId.toString(),
            ...room.participants.map((p: any) => p.toString()),
          ]
          // Remove duplicates
          allUsers = [...new Set(allUsers)]
          // Ensure roomCode is set
          if (!roomCode) {
            roomCode = room.roomCode
          }
        }
      } else {
        // Try to find room by storyId
        const storyId = story.id || story._id
        if (storyId) {
          const room = await Room.findOne({ storyId })
          if (room) {
            allUsers = [
              room.hostId.toString(),
              ...room.participants.map((p: any) => p.toString()),
            ]
            allUsers = [...new Set(allUsers)]
            roomCode = room.roomCode
          }
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

    // If multiplayer, save for all users
    if (isMultiplayer && allUsers.length > 0) {
      const savedStories = await Promise.all(
        allUsers.map(async (targetUserId: string) => {
          try {
            const userPayload = { ...basePayload, userId: targetUserId }
            
            // Try to find existing story for this user with same roomCode
            if (roomCode) {
              const existing = await Story.findOne({
                userId: targetUserId,
                roomCode: roomCode,
                isMultiplayer: true,
              })
              
              if (existing) {
                return await Story.findOneAndUpdate(
                  { _id: existing._id, userId: targetUserId },
                  userPayload,
                  { new: true }
                )
              }
            }
            
            // Create new story for this user
            return await Story.create(userPayload)
          } catch (error) {
            console.error(`Error saving story for user ${targetUserId}:`, error)
            return null
          }
        })
      )

      // Return the story saved for the current user
      const currentUserStory = savedStories.find(
        (s) => s && s.userId.toString() === userId
      ) || savedStories[0]

      return NextResponse.json(
        {
          message: "Story saved for all participants",
          story: currentUserStory,
        },
        { status: 200 },
      )
    }

    // Single player story - save normally
    let doc
    if (storyId) {
      doc = await Story.findOneAndUpdate(
        { _id: storyId, userId },
        { ...basePayload, userId },
        {
          new: true,
        }
      )

      if (!doc) {
        // If not found for this user/id, create a fresh one
        doc = await Story.create({ ...basePayload, userId })
      }
    } else {
      doc = await Story.create({ ...basePayload, userId })
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
