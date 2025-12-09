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
    const { saveAndExit } = body

    await connectDB()

    const room = await Room.findOne({ roomCode })

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    const isHost = room.hostId.toString() === userId
    const isParticipant = room.participants.some(
      (p: any) => p.toString() === userId || (p._id && p._id.toString() === userId),
    )

    if (!isHost && !isParticipant) {
      return NextResponse.json({ error: "You are not a member of this room" }, { status: 403 })
    }

    const otherParticipants = room.participants.filter(
      (p: any) => p.toString() !== userId && (p._id ? p._id.toString() !== userId : true),
    )
    const hasOtherParticipants = otherParticipants.length > 0

    // If the current host tries to leave while there are other participants present,
    // force them to transfer host powers first to keep the game playable.
    if (isHost && room.hostActive !== false && hasOtherParticipants) {
      return NextResponse.json(
        { error: "Transfer host to a participant before exiting the room" },
        { status: 400 },
      )
    }

    // Handle story saving based on exit type
    // If saveAndExit is true, persist ONLY for the leaving user under multiplayer.
    if (saveAndExit && room.storyId && room.status === "playing") {
      const story = await Story.findById(room.storyId)
      if (story) {
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

        try {
          const existing = await Story.findOne({
            userId,
            roomCode: room.roomCode,
            isMultiplayer: true,
          })

          if (existing) {
            await Story.findOneAndUpdate(
              { _id: existing._id, userId },
              { ...storyPayload, userId, savedAt: new Date() },
            )
          } else {
            // Clean up any single-player duplicate for this exact story
            const singlePlayerVersion = await Story.findOne({
              userId,
              $or: [
                { roomCode: { $exists: false } },
                { roomCode: null },
                { isMultiplayer: false },
              ],
              title: story.title,
              genre: story.genre,
            })

            if (singlePlayerVersion) {
              await Story.deleteOne({ _id: singlePlayerVersion._id })
            }

            await Story.create({
              userId,
              ...storyPayload,
              isMultiplayer: true,
              roomCode: room.roomCode,
              savedAt: new Date(),
            })
          }
        } catch (error) {
          console.error(`Error saving story for user ${userId}:`, error)
        }
      }
    }

    // Note: If saveAndExit is false, do not save for anyone and permanently block re-join.
    if (!saveAndExit) {
      const alreadyBlocked = (room.blockedRejoinUsers || []).some(
        (id: any) => id.toString() === userId,
      )
      if (!alreadyBlocked) {
        room.blockedRejoinUsers.push(userId)
      }
    }

    // Remove user's votes from choiceVotes BEFORE promoting new host
    // This ensures vote counts are correct for all participants
    if (room.choiceVotes) {
      room.choiceVotes.forEach((userIds: any[], choiceId: string) => {
        const filtered = userIds.filter((id: any) => id.toString() !== userId)
        if (filtered.length === 0) {
          room.choiceVotes.delete(choiceId)
        } else {
          room.choiceVotes.set(choiceId, filtered)
        }
      })
    }

    // Remove user's votes from genreVotes BEFORE promoting new host
    if (room.genreVotes) {
      room.genreVotes.forEach((userIds: any[], genreId: string) => {
        const filtered = userIds.filter((id: any) => id.toString() !== userId)
        if (filtered.length === 0) {
          room.genreVotes.delete(genreId)
        } else {
          room.genreVotes.set(genreId, filtered)
        }
      })
    }

    // IMPORTANT: Preserve storyId and status - these should never be cleared when someone leaves
    const preservedStoryId = room.storyId
    const preservedStatus = room.status

    if (isHost) {
      // Remove host from participants list if present
      room.participants = room.participants.filter(
        (p: any) => p.toString() !== userId && (p._id ? p._id.toString() !== userId : true),
      )

      // If no participants remain, mark host slot inactive so the next joiner can become host
      room.hostActive = false
      room.newHostNotification = null
    } else {
      // Remove user from participants (normal participant exit)
      room.participants = room.participants.filter(
        (p: any) => p.toString() !== userId && (p._id ? p._id.toString() !== userId : true),
      )
    }

    // Explicitly preserve storyId and status to ensure they're never lost
    room.storyId = preservedStoryId
    room.status = preservedStatus

    await room.save()

    return NextResponse.json({
      message: "Left room successfully",
    })
  } catch (error) {
    console.error("Leave room error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

