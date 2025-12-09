import mongoose, { Schema, models, model } from "mongoose"

const RoomSchema = new Schema(
  {
    roomCode: { type: String, required: true, unique: true, index: true },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hostActive: { type: Boolean, default: true }, // Tracks if a host is currently present in the room
    participants: [{ type: Schema.Types.ObjectId, ref: "User" }],
    blockedRejoinUsers: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }], // Users who chose hard exit
    status: {
      type: String,
      enum: ["waiting", "voting-genre", "playing", "completed"],
      default: "waiting",
    },
    genreVotes: {
      type: Map,
      of: [Schema.Types.ObjectId], 
      default: new Map(),
    },
    selectedGenre: { type: String, default: null },
    storyId: { type: Schema.Types.ObjectId, ref: "Story", default: null },
    choiceVotes: {
      type: Map,
      of: [Schema.Types.ObjectId], 
      default: new Map(),
    },
    currentChoiceIndex: { type: Number, default: 0 },
    isProcessing: { type: Boolean, default: false }, // Track if choice is being processed
    lastChoiceEvaluation: {
      quality: { type: String, enum: ["excellent", "good", "average", "bad"], default: null },
      message: { type: String, default: null },
    },
    tiedChoicesForVoting: { type: [String], default: [] }, // Track tied choices that need re-voting
    messages: [{
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      username: { type: String, required: true },
      message: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    }],
    newHostNotification: { type: Schema.Types.ObjectId, ref: "User", default: null }, // Track when host changes for notification
    createdAt: { type: Date, default: Date.now, expires: 86400 }, // Auto-delete after 24 hours
  },
  { timestamps: true },
)

const Room = models.Room || model("Room", RoomSchema)

export default Room

