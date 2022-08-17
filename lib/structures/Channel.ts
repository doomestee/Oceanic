/* eslint-disable import/order */
import Base from "./Base";
import { ChannelTypes } from "../Constants";
import type Client from "../Client";
import type {
	AnyChannel,
	RawCategoryChannel,
	RawChannel,
	RawGroupChannel,
	RawNewsChannel,
	RawNewsThreadChannel,
	RawPrivateChannel,
	RawPrivateThreadChannel,
	RawPublicThreadChannel,
	RawStageChannel,
	RawTextChannel,
	RawVoiceChannel
} from "../types/channels";

export default class Channel extends Base {
	type: ChannelTypes;
	constructor(data: RawChannel, client: Client) {
		super(data.id, client);
		this.type = data.type;
	}

	static from<T extends Channel = AnyChannel>(data: RawChannel, client: Client): T {
		switch (data.type) {
			case ChannelTypes.GUILD_TEXT: return new TextChannel(data as RawTextChannel, client) as unknown as T;
			case ChannelTypes.DM: return new PrivateChannel(data as RawPrivateChannel, client) as unknown as T;
			case ChannelTypes.GUILD_VOICE: return new VoiceChannel(data as RawVoiceChannel, client) as unknown as T;
			case ChannelTypes.GROUP_DM: return new GroupChannel(data as RawGroupChannel, client) as unknown as T;
			case ChannelTypes.GUILD_CATEGORY: return new CategoryChannel(data as RawCategoryChannel, client) as unknown as T;
			case ChannelTypes.GUILD_NEWS: return new NewsChannel(data as RawNewsChannel, client) as unknown as T;
			case ChannelTypes.GUILD_NEWS_THREAD: return new NewsThreadChannel(data as RawNewsThreadChannel, client) as unknown as T;
			case ChannelTypes.GUILD_PUBLIC_THREAD: return new PublicThreadChannel(data as RawPublicThreadChannel, client) as unknown as T;
			case ChannelTypes.GUILD_PRIVATE_THREAD: return new PrivateThreadChannel(data as RawPrivateThreadChannel, client) as unknown as T;
			case ChannelTypes.GUILD_STAGE_VOICE: return new StageChannel(data as RawStageChannel, client) as unknown as T;
			default: return new Channel(data, client) as T;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
	protected update(data: RawChannel) {}

	/** A string that will mention this channel. */
	get mention() {
		return `<#${this.id}>`;
	}

	/**
	 * Close a direct message, leave a group channel, or delete a guild channel.
	 *
	 * @returns {Promise<void>}
	 */
	async delete() {
		await this._client.rest.channels.delete(this.id);
	}
}

// Yes this sucks, but it works. That's the important part. Circular imports are hell.
/* eslint-disable */
const TextChannel = require("./TextChannel") as typeof import("./TextChannel").default;
const PrivateChannel = require("./PrivateChannel") as typeof import("./PrivateChannel").default;
const VoiceChannel = require("./VoiceChannel") as typeof import("./VoiceChannel").default;
const CategoryChannel = require("./CategoryChannel") as typeof import("./CategoryChannel").default;
const GroupChannel = require("./GroupChannel") as typeof import("./GroupChannel").default;
const NewsChannel = require("./NewsChannel") as typeof import("./NewsChannel").default;
const PublicThreadChannel = require("./PublicThreadChannel") as typeof import("./PublicThreadChannel").default;
const PrivateThreadChannel = require("./PrivateThreadChannel") as typeof import("./PrivateThreadChannel").default;
const NewsThreadChannel = require("./NewsThreadChannel") as typeof import("./NewsThreadChannel").default;
const StageChannel = require("./StageChannel") as typeof import("./StageChannel").default;
/* eslint-enable */