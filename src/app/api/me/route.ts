import { privateJson } from "@/lib/http/private-response";
import { getCurrentSession } from "@/lib/auth/session";
import { JsonRequestError, jsonErrorMessage, readJsonObject } from "@/lib/http/json";
import {
  getUserProfile,
  ProfileValidationError,
  updateUserProfile
} from "@/lib/users/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCurrentSession();
  const user = await getUserProfile(session.userId);

  return privateJson({
    session: {
      provider: session.provider,
      replaceWith: "Auth.js or another production session provider"
    },
    user
  });
}

export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    const body = await readJsonObject(request);
    const user = await updateUserProfile(session.userId, body);

    return privateJson({ user });
  } catch (error) {
    if (error instanceof JsonRequestError) {
      return privateJson(
        { error: jsonErrorMessage(error, "Failed to update profile.") },
        { status: 400 }
      );
    }

    if (error instanceof ProfileValidationError) {
      return privateJson({ error: profileErrorMessage(error) }, { status: 400 });
    }

    throw error;
  }
}

function profileErrorMessage(error: ProfileValidationError) {
  switch (error.message) {
    case "nickname must be a string.":
      return "nickname must be a string.";
    case "nickname must be between 1 and 40 characters.":
      return "nickname must be between 1 and 40 characters.";
    case "timezone must be a string.":
      return "timezone must be a string.";
    case "timezone must be between 1 and 64 characters.":
      return "timezone must be between 1 and 64 characters.";
    case "language must be a string.":
      return "language must be a string.";
    case "language must be between 2 and 16 characters.":
      return "language must be between 2 and 16 characters.";
    case "proactiveMessagesEnabled must be a boolean.":
      return "proactiveMessagesEnabled must be a boolean.";
    case "proactiveFrequencyHours must be an integer from 1 to 168.":
      return "proactiveFrequencyHours must be an integer from 1 to 168.";
    default:
      return "Failed to update profile.";
  }
}
