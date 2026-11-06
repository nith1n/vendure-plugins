import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoProductOwnerImageRun1793959939210 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "akeneo_image_run" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "runId" character varying(64) NOT NULL, "queued" integer NOT NULL DEFAULT '0', "completed" integer NOT NULL DEFAULT '0', "failed" integer NOT NULL DEFAULT '0', "downloaded" integer NOT NULL DEFAULT '0', "reused" integer NOT NULL DEFAULT '0', "assigned" integer NOT NULL DEFAULT '0', "skipped" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "PK_5adcbf49bcff8933f1f9bb294bb" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9c9269803836f1c002426693b7" ON "akeneo_image_run" ("runId") `, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsAkeneochannelid" character varying(255)`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b5d5f2bf646101583e8a09ac36" ON "product" ("customFieldsAkeneochannelid") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_b5d5f2bf646101583e8a09ac36"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsAkeneochannelid"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9c9269803836f1c002426693b7"`, undefined);
        await queryRunner.query(`DROP TABLE "akeneo_image_run"`, undefined);
   }

}
