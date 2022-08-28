import User from "./User";
import type Client from "../Client";
import type { EditSelfUserOptions, RawOAuthUser } from "../types/users";
import type { JSONExtendedUser } from "../types/json";
/** Represents the currently authenticated user (oauth). */
export default class ExtendedUser extends User {
    /** The user's email. (always null for bots) */
    email: string | null;
    /** The flags of the user. */
    flags: number;
    /** The locale of the user */
    locale?: string;
    /** If the user has mfa enabled on their account */
    mfaEnabled: boolean;
    /** If this user's email is verified. (always true for bots) */
    verified: boolean;
    constructor(data: RawOAuthUser, client: Client);
    protected update(data: Partial<RawOAuthUser>): void;
    /**
     * Modify this user.
     *
     * @param {Object} options
     * @param {String} [options.username] - The new username
     * @param {?(String | Buffer)} [options.avatar] - The new avatar (buffer, or full data url). `null` to remove the current avatar.
     * @returns {Promise<ExtendedUser>}
     */
    edit(options: EditSelfUserOptions): Promise<ExtendedUser>;
    toJSON(): JSONExtendedUser;
}