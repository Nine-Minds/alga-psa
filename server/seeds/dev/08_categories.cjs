const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const boardId = async (boardName) => (await db.table('boards')
        .where({ board_name: boardName })
        .select('board_id')
        .first())?.board_id ?? null;
    const categoryId = async (categoryName) => (await db.table('categories')
        .where({ category_name: categoryName })
        .select('category_id')
        .first())?.category_id ?? null;
    const glindaUserId = (await db.table('users')
        .where({ username: 'glinda' })
        .select('user_id')
        .first())?.user_id ?? null;

    const categoryRow = async ({ categoryName, displayOrder, boardName, parentCategory }) => ({
        tenant: tenantId,
        category_name: categoryName,
        display_order: displayOrder,
        board_id: await boardId(boardName),
        ...(parentCategory ? { parent_category: await categoryId(parentCategory) } : {}),
        created_by: glindaUserId
    });

    const parentCategories = [
        { categoryName: 'Magical Artifacts', displayOrder: 1, boardName: 'Urgent Matters' },
        { categoryName: 'Creature Encounters', displayOrder: 2, boardName: 'Urgent Matters' },
        { categoryName: 'Landscape Anomalies', displayOrder: 3, boardName: 'Technical Issues' },
        { categoryName: 'Character Assistance', displayOrder: 4, boardName: 'General Support' },
        { categoryName: 'Realm Maintenance', displayOrder: 5, boardName: 'Projects' }
    ];

    const subCategories = [
        { categoryName: 'Enchanted Accessories', displayOrder: 1, boardName: 'Urgent Matters', parentCategory: 'Magical Artifacts' },
        { categoryName: 'Potions and Elixirs', displayOrder: 2, boardName: 'Urgent Matters', parentCategory: 'Magical Artifacts' },
        { categoryName: 'Talking Animals', displayOrder: 1, boardName: 'Urgent Matters', parentCategory: 'Creature Encounters' },
        { categoryName: 'Mythical Beings', displayOrder: 2, boardName: 'Urgent Matters', parentCategory: 'Creature Encounters' },
        { categoryName: 'Impossible Geography', displayOrder: 1, boardName: 'Technical Issues', parentCategory: 'Landscape Anomalies' },
        { categoryName: 'Weather Oddities', displayOrder: 2, boardName: 'Technical Issues', parentCategory: 'Landscape Anomalies' },
        { categoryName: 'Quest Guidance', displayOrder: 1, boardName: 'General Support', parentCategory: 'Character Assistance' },
        { categoryName: 'Magical Transformations', displayOrder: 2, boardName: 'General Support', parentCategory: 'Character Assistance' },
        { categoryName: 'Portal Management', displayOrder: 1, boardName: 'Projects', parentCategory: 'Realm Maintenance' },
        { categoryName: 'Magical Infrastructure', displayOrder: 2, boardName: 'Projects', parentCategory: 'Realm Maintenance' }
    ];

    await db.table('categories').del();
    await db.table('categories').insert(await Promise.all(parentCategories.map(categoryRow)));
    return db.table('categories').insert(await Promise.all(subCategories.map(categoryRow)));
};
