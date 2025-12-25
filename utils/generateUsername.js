import User from "../models/User.js";

export async function generateUniqueUsername(base = "player") {
  let username;
  let exists = true;

  while (exists) {
    username = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    exists = await User.exists({ username });
  }

  return username;
}
