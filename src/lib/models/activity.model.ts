import mongoose, { Schema } from "mongoose";

import { registerModel } from "./register-model";

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
      default: null,
    },
    type: {
      type: String,
      enum: ["note", "call", "email", "status_change", "reminder", "import", "payment"],
      required: true,
    },
    content: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Activity =
  registerModel("Activity", activitySchema);
