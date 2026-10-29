import { DataTypes, Model, type Sequelize } from "sequelize";

export class TrackedMessageModel extends Model {
    declare guildId: string;
    declare kind: string;
    declare key: string;
    declare channelId: string;
    declare messageId: string;
    declare deleteAt: number | null;
}

export function initTrackedMessageModel(sequelize: Sequelize): typeof TrackedMessageModel {
    class BoundTrackedMessageModel extends TrackedMessageModel {}
    BoundTrackedMessageModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            kind: { type: DataTypes.STRING, allowNull: false, primaryKey: true },
            key: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "message_key" },
            channelId: { type: DataTypes.STRING, allowNull: false, field: "channel_id" },
            messageId: { type: DataTypes.STRING, allowNull: false, field: "message_id" },
            deleteAt: { type: DataTypes.BIGINT, allowNull: true, field: "delete_at" },
        },
        { sequelize, tableName: "tracked_messages", timestamps: false },
    );
    return BoundTrackedMessageModel;
}
