import { Sequelize } from "sequelize";
import { config } from "../config";
import { bunSqliteDriver } from "./bunSqliteDriver";

const SQLITE_PATH = "./data/linking.sqlite";

function createSequelize(): Sequelize {
    switch (config.databaseDialect) {
        case "sqlite":
            return new Sequelize({
                dialect: "sqlite",
                dialectModule: bunSqliteDriver,
                storage: SQLITE_PATH,
                logging: false,
            });
        case "postgres":
            throw new Error('databaseDialect "postgres" is not supported yet.');
    }
}

export const sequelize = createSequelize();
