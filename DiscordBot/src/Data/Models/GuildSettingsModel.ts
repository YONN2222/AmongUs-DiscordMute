import { DataTypes, Model, type Sequelize } from "sequelize";

export class GuildSettingsModel extends Model {
    declare guildId: string;
    declare data: string;
}

export function initGuildSettingsModel(sequelize: Sequelize): typeof GuildSettingsModel {
    class BoundGuildSettingsModel extends GuildSettingsModel {}
    BoundGuildSettingsModel.init(
        {
            guildId: { type: DataTypes.STRING, allowNull: false, primaryKey: true, field: "guild_id" },
            data: { type: DataTypes.TEXT, allowNull: false },
        },
        { sequelize, tableName: "guild_settings", timestamps: false },
    );
    return BoundGuildSettingsModel;
}
