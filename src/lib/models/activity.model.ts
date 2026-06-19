import mongoose, { Schema } from "mongoose";

const activitySchema = new Schema(
  {
    prospectId: {
      type: Schema.Types.ObjectId,
      ref: "Prospect",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["note", "call", "email", "status_change", "reminder", "import"],
      required: true,
    },
    content: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Activity =
  mongoose.models.Activity || mongoose.model("Activity", activitySchema);
