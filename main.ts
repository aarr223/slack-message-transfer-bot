import {
  Message,
  Client,
  GatewayIntentBits,
  DiscordAPIError,
} from "discord.js";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

// --------------------------------------
// web server
// --------------------------------------
const app = express();
app.get("/ping", (_, res) => {
  res.status(200).send("pong");
});
app.listen(process.env.PORT || 3001);

// --------------------------------------
// discord bot
// --------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// -----------------
// on ready
// -----------------
client.once("ready", () => {
  console.log("Ready!");
});

// -----------------
// on message create
// -----------------
client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!mentioned(message)) return;
  if (notExistAttachments(message)) {
    message.channel.send(
      "slackからエクスポートしたメッセージファイルと`users.json`というファイルを添付してください。"
    );
    return;
  }

  const jsonFiles = await fetchJsonFiles(message);

  const usersJsonFile = findUsersJsonFile(jsonFiles);
  if (!usersJsonFile) {
    message.channel.send("`users.json`というファイルを添付してください。");
    return;
  }

  const users = extractUsers(usersJsonFile);

  const slackMessageJsonFiles = jsonFiles.filter(
    (json) => json?.name !== "users.json"
  );
  if (!slackMessageJsonFiles) {
    message.channel.send(
      "slackからエクスポートしたメッセージファイルを添付してください。"
    );
    return;
  }

  slackMessageJsonFiles
    .slice()
    .sort((a, b) => a?.name?.localeCompare(b?.name ?? "") ?? 0)
    .forEach((slackMessageJsonFile) => {
      slackMessageJsonFile?.json
        .filter(filterMessage)
        .slice()
        .sort((a, b) => a["ts"].localeCompare(b["ts"]))
        .map((slackMessage) => {
          // discordの1メッセージあたりの最大文字数は2000文字なので、余裕をもって1900文字を超えたら分割する
          if (slackMessage["text"].length > 1900) {
            return splitSlackMessage(slackMessage, users);
          }

          return `${findUser(users, slackMessage["user"])?.name}: ${buildText(
            slackMessage["text"]
          )} (${toLocaleString(slackMessage["ts"])})`;
        })
        .forEach(async (text) => {
          if (typeof text === "string") {
            await sendMessage(message, text);
          } else {
            text?.forEach(
              async (splittedText) => await sendMessage(message, splittedText)
            );
          }
        });
    });
});

client.login(process.env.TOKEN);

// --------------------------------------
// types
// --------------------------------------
type SlackMessageJson = {
  name: string;
  json: any[];
};

type User = {
  id: string;
  name: string;
};

// --------------------------------------
// functions
// --------------------------------------
const mentioned = (message: Message) => {
  return message.mentions.users.some((user) => user.id === client?.user?.id);
};

const notExistAttachments = (message: Message) => {
  return message.attachments.size === 0;
};

const fetchJsonFiles: (
  message: Message<boolean>
) => Promise<SlackMessageJson[]> = async (message) => {
  return Promise.all(
    message.attachments.map(async (attachment) => {
      const response = await fetch(attachment.attachment as string);
      const json = await response.json();
      return {
        name: attachment.name!,
        json: json as any[],
      };
    })
  );
};

const extractUsers: (usersJsonFile: SlackMessageJson) => User[] = (
  usersJsonFile
) => {
  return usersJsonFile?.json.map((json) => ({
    id: json["id"],
    name:
      json["profile"]["display_name_normalized"] ??
      json["profile"]["display_name"] ??
      json["profile"]["real_name_normalized"] ??
      json["real_name"] ??
      json["name"],
  }));
};

const findUsersJsonFile = (jsonFiles: SlackMessageJson[]) => {
  return jsonFiles.find((json) => json?.name === "users.json");
};

const findUser = (users: User[], messageUser: string) => {
  return users.find((user) => user.id === messageUser);
};

const buildText = (text: string) => {
  return text.startsWith("<http") ? text.split("|")[0].slice(1) : text;
};

const filterMessage = (slackMessage: any) =>
  slackMessage["type"] === "message" &&
  slackMessage["subtype"] !== "channel_join" &&
  !!slackMessage["text"];

const toLocaleString = (ts: string) => {
  return new Date(parseInt(ts) * 1000).toLocaleString();
};

const splitSlackMessage = (slackMessage: any, users: User[]) => {
  const text: string = slackMessage["text"];
  const textChunks = text.match(/.{1900}/g);

  return textChunks?.map((chunk, i) => {
    // 最初のメッセージにはユーザー名を付加
    if (i === 0) {
      return `${findUser(users, slackMessage["user"])?.name}: ${buildText(
        chunk
      )}`;
    }

    // 最後のメッセージには日時を付加
    if (i === textChunks.length - 1) {
      return `${buildText(chunk)} (${toLocaleString(slackMessage["ts"])})`;
    }

    // それ以外のメッセージはそのまま
    return buildText(chunk);
  });
};

const sendMessage = async (message: Message, text: string) => {
  try {
    await message.channel.send(text);
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      console.error(error.rawError);
    } else {
      console.error(error);
    }
  }
};
