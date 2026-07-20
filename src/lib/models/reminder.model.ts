import { Schema } from "mongoose";

import { registerModel } from "./register-model";

const reminderSchema = new Schema(
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
      index: true,
    },
    dueDate: { type: Date, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    isCompleted: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Reminder =
  registerModel("Reminder", reminderSchema);
