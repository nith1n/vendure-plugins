import {MigrationInterface, QueryRunner} from "typeorm";

export class AkeneoVariantCategory1793874662766 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "akeneo_variant_category" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "categoryCode" character varying(255) NOT NULL, "id" SERIAL NOT NULL, "variantId" integer NOT NULL, CONSTRAINT "PK_a5c48f038212b20f6ae1e256ca9" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_349ca9130aa23ec6a09eebcf60" ON "akeneo_variant_category" ("variantId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_2c587b196159096e907cc7f72a" ON "akeneo_variant_category" ("categoryCode") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_975ef7f6329bc6c869399acc6e" ON "akeneo_variant_category" ("variantId", "categoryCode") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_975ef7f6329bc6c869399acc6e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_2c587b196159096e907cc7f72a"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_349ca9130aa23ec6a09eebcf60"`, undefined);
        await queryRunner.query(`DROP TABLE "akeneo_variant_category"`, undefined);
   }

}
