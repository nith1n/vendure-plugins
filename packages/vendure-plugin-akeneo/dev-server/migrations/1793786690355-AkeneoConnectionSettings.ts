import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoConnectionSettings1793786690355 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "akeneo_connection_settings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "baseUrl" character varying(255) NOT NULL, "clientId" character varying(255) NOT NULL, "encryptedSecret" text NOT NULL, "username" character varying(255) NOT NULL, "encryptedPassword" text NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "lastValidationStatus" character varying(16) NOT NULL DEFAULT 'UNTESTED', "lastValidatedAt" TIMESTAMP, "lastValidationError" text, "id" SERIAL NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "PK_6548197ff9988ceefd50c948e3d" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e6d719db2da56de83737eca9b0" ON "akeneo_connection_settings" ("channelId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_e6d719db2da56de83737eca9b0"`, undefined);
        await queryRunner.query(`DROP TABLE "akeneo_connection_settings"`, undefined);
   }

}
