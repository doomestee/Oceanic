import TextableChannel from "./TextableChannel";
import type NewsChannel from "./NewsChannel";
import type { ThreadAutoArchiveDuration } from "../Constants";
import { ChannelTypes } from "../Constants";
import type Client from "../Client";
import type { EditTextChannelOptions, RawTextChannel } from "../types/channels";
import { RawOverwrite } from "../types/channels";

/** Represents a guild text channel. */
export default class TextChannel extends TextableChannel {
	declare type: ChannelTypes.GUILD_TEXT;
	constructor(data: RawTextChannel, client: Client) {
		super(data, client);
	}

	/**
	 * Convert this text channel to a news channel.
	 *
	 * @returns {Promise<NewsChannel>}
	 */
	async convert() {
		return this.edit({ type: ChannelTypes.GUILD_NEWS })  as unknown as NewsChannel;
	}

	/**
	 * Edit this channel.
	 *
	 * @param {Object} options
	 * @param {?ThreadAutoArchiveDuration} [options.defaultAutoArchiveDuration] - The default auto archive duration for threads made in this channel.
	 * @param {String} [options.name] - The name of the channel.
	 * @param {?Boolean} [options.nsfw] - If the channel is age gated.
	 * @param {?String} [options.parentID] - The id of the parent category channel.
	 * @param {?RawOverwrite[]} [options.permissionOverwrites] - Channel or category specific permissions
	 * @param {?Number} [options.position] - The position of the channel in the channel list.
	 * @param {?Number} [options.rateLimitPerUser] - The seconds between sending messages for users. Between 0 and 21600.
	 * @param {?String} [options.topic] - The topic of the channel.
	 * @param {ChannelTypes.GUILD_NEWS} [options.type] - Provide the opposite type to convert the channel.
	 * @param {String} [reason] - The reason to be displayed in the audit log.
	 * @returns {Promise<TextChannel>}
	 */
	override async edit(options: EditTextChannelOptions, reason?: string) {
		return this._client.rest.channels.edit<TextChannel>(this.id, options, reason);
	}
}