import { Message, Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log("Ready!");
});

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!mentioned(message)) return;
  if (notExistAttachments(message)) {
    message.channel.send(
      "slackからエクスポートしたファイルを添付してください。"
    );
    return;
  }

  const jsonFiles = await fetchJsonFiles(message);

  console.log(jsonFiles);

  const usersJsonFile = findUsersJsonFile(jsonFiles);

  if (!usersJsonFile) {
    message.channel.send("`users.json`というファイルを添付してください。");
    return;
  }

  const users = extractUsers(usersJsonFile);

  jsonFiles
    .filter((json) => json?.name !== "users.json")
    .slice()
    .sort((a, b) => a?.name?.localeCompare(b?.name ?? "") ?? 0)
    .forEach((slackMessageJsonFile) => {
      slackMessageJsonFile?.json
        .filter(filterMessage)
        .map((slackMessage) => {
          return `${findUser(users, slackMessage["user"])?.name}: ${buildText(
            slackMessage["text"]
          )} (${toLocaleString(slackMessage["ts"])})`;
        })
        .forEach((text) => {
          message.channel.send(text);
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