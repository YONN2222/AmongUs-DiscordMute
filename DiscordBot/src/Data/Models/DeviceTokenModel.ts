import { DataTypes, Model, type Sequelize } from "sequelize";

export class DeviceTokenModel extends Model {
    declare id: string;
    declare guildId: string;
    declare tokenHash: string;
    declare platform: string;
    declare createdAt: number;
    declare lastUsedAt: number | null;
}

export function initDeviceTokenModel(sequelize: Sequelize): typeof DeviceTokenModel {
    class BoundDeviceTokenModel extends DeviceTokenModel {}
    BoundDeviceTokenModel.init(
        {
            id: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
            guildId: { type: DataTypes.STRING, allowNull: false, field: "guild_id" },
            tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true, field: "token_hash" },
            platform: { type: DataTypes.STRING(16), allowNull: false },
            createdAt: { type: DataTypes.BIGINT, allowNull: false, field: "created_at" },
            lastUsedAt: { type: DataTypes.BIGINT, allowNull: true, field: "last_used_at" },
        },
        { sequelize, tableName: "device_tokens", timestamps: false },
    );
    return BoundDeviceTokenModel;
}
