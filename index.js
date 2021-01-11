/**
 * Комментарии будут на расском, потому что русский язык - могучий язык!!!
 * 
 * За качество кода не ручаюсь, написал на быструю руку для себя,
 * но захотелось выложить на GitHub. Вдруг кому нужно будет
 */

// Импорты
const fs = require('fs');
const { promises } = require('fs');
const { VK, MessageContext } = require('vk-io');

// Конфиг (инструкция по настройке конфига ищите README.md)
const config = require('./config.json');

if (!config.token) {
    throw new ReferenceError('Не указан параметр `token` в конфигурации');
}

const vk = new VK({
    token: config.token
});

// Для удобства и чтобы не было путаницы, создал с помощью jsdoc новый тип - Chat

/**
 * @typedef Chat
 * @property {Record<string, MessageContext>} messages Сообщения данной беседы
 * @property {number} deletedMessages Количество удалённых сообщений в этой беседе
 * @property {number} editedMessages Количество отредактированных сообщений в этой беседе
 */

/**
 * @type {Record<string, Chat>}
 */
let chats = {};

/**
 * Если обнаружен файл с сохранёнными чатами, то берём его за основной,
 * если его нет то пустой объект (т.е. значение по умолчанию)
 * 
 * Если в самом файле будут ошибки, то программа выдаст исключение
 */
if (fs.existsSync(`${__dirname}/${config.pathToChats}`)) {
    try {
        chats = JSON.parse(fs.readFileSync(`${__dirname}/${config.pathToChats}`));
    } catch(e) {
        throw e;
    }
}

/**
 * Прошаренные программисты закидают меня тапками за такой финт ушами,
 * но мне абсолютно пофиг на качество этого кода + это удобно
 * 
 * Кто не понял - этим действием я добавил к любому экземпляру объекта
 * новое свойство `len`, которое возвращает количетсво пар ключ-значение
 * Аналог .length у массивов
 * 
 * Сразу отвечаю на вопрос "Зачем тут пустой set?"
 * - JS кидает исключение если его не будет.
 */
Object.defineProperty(Object.prototype, 'len', {
    set() {},
    get() {
        return Object.keys(this).length;
    }
});

/**
 * Самое интересное, здесь происходит пополнение самих чатов и сообщений в чатах,
 * а также сразу логика поиска отредактированных сообщений
 * + команда вывода статистики по данному чату
 */
vk.updates.on('message', async (context) => {
    if (context.isOutbox || context.senderId < 0 || !context.isChat) return;

    if (!chats[context.chatId]) {
        chats[context.chatId] = {
            messages: {},
            deletedMessages: 0,
            editedMessages: 0
        };
    }
    
    const chat = chats[context.chatId];

    if (
        config.admins.length > 0
        && config.admins.includes(context.senderId)
        && /^stats$/i.test(context.text)
    ) {
        await context.send([
            `-- Статистика беседы #${context.chatId} --`,
            `Сохранено сообщений: ${chat.messages.len}`,
            `Удалено сообщений: ${chat.deletedMessages}`,
            `Отредактированно сообщений: ${chat.editedMessages}`
        ].join('\n'));

        return;
    }
    
    // ВК дебил :(
    await context.loadMessagePayload();

    if (!chat.messages[context.id]) {
        if (chat.messages.len >= config.maxSavedMessagesInChat) {
            /**
             * Цикл здесь исправляет ситуацию, когда вы изменили в конфиге свойство `maxSavedMessagesInChat`
             * с большего числа на меньшее более чем на одиницу. Цикл удаляет все сообщения с начала
             */
            const times = chat.messages.len - config.maxSavedMessagesInChat;
            for (let i = 0; i <= times; i ++)
                delete chat.messages[Object.keys(chat.messages)[0]];
        }

        chat.messages[context.id] = context;
    }

    if (config.editTrigger && context.is(['message_edit']) && chat.messages[context.id]) {
        const [user] = await vk.api.users.get({ user_ids: [context.senderId] });
        const oldContext = chat.messages[context.id];
        if (!oldContext) return;

        chat.messages[context.id] = context;
        chat.editedMessages++;

        await context.send(`${user.first_name} ${user.last_name} отредактировал сообщение!`);
        await context.send(oldContext.text || 'Нет текста', {
            attachment: oldContext.attachments || []
        });
        await context.send(context.text || 'Нет текста', {
            attachment: context.attachments || []
        });
    }
});

/**
 * Для тех, кто не знал - ВК даёт возможность получать события удаления сообщения.
 * Там на самом деле ещё много разных интересных событий существует, но остановимся пока на этом
 */
vk.updates.on('message_flags', async (context) => {
    if (!config.deleteTrigger || !context.isDeletedForAll) return;

    const chat = chats[context.peerId - 2e9];
    if (!chat.messages.len) return;

    const oldContext = chat.messages[context.id];
    if (!oldContext) return;

    delete chat.messages[context.id];
    chat.deletedMessages++;

    const [user] = await vk.api.users.get({ user_ids: [oldContext.senderId] });
    await vk.api.messages.send({
        peer_id: context.peerId,
        message: `${user.first_name} ${user.last_name} удалил сообщение!`,
        random_id: Date.now()
    });
    await vk.api.messages.send({
        peer_id: context.peerId,
        message: oldContext.text || 'Нет текста',
        attachment: oldContext.attachments,
        random_id: Date.now()
    });
});

vk.updates.start().then(() => {
    console.log('Бот запущен');
});

// Одно из самых ущербных, что я делал... Но зато без лишних библиотек ;)
setInterval(() => {
    return promises.writeFile(
        `${__dirname}/${config.pathToChats}`,
        JSON.stringify(chats, null, '    ')
    );
}, 1000);