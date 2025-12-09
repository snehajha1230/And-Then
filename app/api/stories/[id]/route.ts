import { NextRequest, NextResponse } from "next/server"
import { getDataFromToken } from "@/helpers/getDataFromToken"
import { connectDB } from "@/db/dbconfig"
import Story from "@/models/story.model"
import Room from "@/models/room.model"
import mongoose from "mongoose"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const userId = getDataFromToken(request)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await context.params

    await connectDB()

    // First, try to find story owned by user
    let story = await Story.findOne({ _id: id, userId }).lean()
    
    // If not found, check if user is a participant or host in a multiplayer room with this story
    // This is important for multiplayer stories where the story might be owned by the original host
    // Also handles cases where host has changed but story is still owned by original host
    if (!story) {
      // Check if user is host or participant in a room with this story
      // Use string comparison to handle ObjectId conversion
      // IMPORTANT: Don't use lean() to ensure we get the latest room state
      // This handles race conditions when host changes
      // Also try both ObjectId and string comparison for storyId
      let room = null
      
      // Try to find room by storyId (handle both ObjectId and string)
      try {
        // Try with ObjectId first if valid
        if (mongoose.Types.ObjectId.isValid(id)) {
          room = await Room.findOne({ 
            storyId: new mongoose.Types.ObjectId(id),
          })
        }
        
        // If not found, try with string
        if (!room) {
          room = await Room.findOne({ 
            storyId: id,
          })
        }
      } catch (error) {
        console.error("Error finding room by storyId:", error)
        // Continue to try string lookup
        room = await Room.findOne({ 
          storyId: id,
        })
      }
      
      if (room) {
        // Check if user is the host (compare as strings)
        // Handle both populated and unpopulated hostId
        const hostIdString = typeof room.hostId === "object" && room.hostId?._id 
          ? room.hostId._id.toString() 
          : room.hostId?.toString()
        const isHost = hostIdString === userId
        
        // Check if user is in participants array
        const isParticipant = room.participants?.some((p: any) => {
          const pId = typeof p === "object" && p._id ? p._id.toString() : p.toString()
          return pId === userId
        })
        
        if (isHost || isParticipant) {
          // User is part of a room with this story, allow access
          // Don't filter by userId since the story might be owned by the original host
          story = await Story.findOne({ _id: id }).lean()
          
          if (!story) {
            console.error(`Story ${id} not found in database, but room ${room.roomCode} references it. Room hostId: ${hostIdString}, userId: ${userId}`)
            return NextResponse.json({ error: "Story not found" }, { status: 404 })
          }
        } else {
          // User is not part of the room
          console.warn(`User ${userId} attempted to access story ${id} but is not host or participant in room ${room.roomCode}. Current host: ${hostIdString}`)
          return NextResponse.json({ error: "Story not found" }, { status: 404 })
        }
      } else {
        // No room found with this storyId - user doesn't own it and isn't in a multiplayer room
        return NextResponse.json({ error: "Story not found" }, { status: 404 })
      }
    }
    
    if (!story) {
      return NextResponse.json({ error: "Story not found" }, { status: 404 })
    }

    return NextResponse.json({ story }, { status: 200 })
  } catch (error: any) {
    console.error("Get story error:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const userId = getDataFromToken(request)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await context.params

    await connectDB()

    const result = await Story.deleteOne({ _id: id, userId })
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Story not found" }, { status: 404 })
    }

    return NextResponse.json({ message: "Story deleted" }, { status: 200 })
  } catch (error: any) {
    console.error("Delete story error:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
