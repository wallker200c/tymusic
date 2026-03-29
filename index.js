const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const queues = new Map();

const commands = [
  new SlashCommandBuilder().setName('play').setDescription('Tocar música').addStringOption(opt =>
    opt.setName('nome').setDescription('Nome da música').setRequired(true)
  ),
  new SlashCommandBuilder().setName('skip').setDescription('Pular música'),
  new SlashCommandBuilder().setName('pause').setDescription('Pausar'),
  new SlashCommandBuilder().setName('resume').setDescription('Continuar'),
  new SlashCommandBuilder().setName('stop').setDescription('Parar tudo')
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`🔥 Online: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // 🔥 RESPONDE RÁPIDO (evita erro do Discord)
  await interaction.deferReply();

  // 🔥 pega o membro corretamente
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    return interaction.editReply('❌ Entre em um canal de voz!');
  }

  let serverQueue = queues.get(interaction.guild.id);

  if (commandName === 'play') {
    try {
      const query = interaction.options.getString('nome');

      const result = await play.search(query, { limit: 1 });
      if (!result.length)
        return interaction.editReply('❌ Música não encontrada');

      const song = {
        title: result[0].title,
        url: result[0].url,
        thumbnail: result[0].thumbnails[0].url
      };

      if (!serverQueue) {
        serverQueue = {
          voiceChannel,
          connection: null,
          player: createAudioPlayer(),
          songs: []
        };
        queues.set(interaction.guild.id, serverQueue);

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator
        });

        serverQueue.connection = connection;
        connection.subscribe(serverQueue.player);
      }

      serverQueue.songs.push(song);

      const embed = new EmbedBuilder()
        .setTitle('🎶 Música adicionada')
        .setDescription(`[${song.title}](${song.url})`)
        .setThumbnail(song.thumbnail)
        .setColor('Blue');

      await interaction.editReply({ embeds: [embed] });

      if (serverQueue.songs.length === 1) {
        playSong(interaction.guild);
      }

    } catch (err) {
      console.error(err);
      interaction.editReply('❌ Erro ao tocar música');
    }
  }

  if (commandName === 'skip') {
    if (!serverQueue) return interaction.editReply('❌ Nada tocando');
    serverQueue.player.stop();
    interaction.editReply('⏭️ Pulado!');
  }

  if (commandName === 'pause') {
    if (!serverQueue) return interaction.editReply('❌ Nada tocando');
    serverQueue.player.pause();
    interaction.editReply('⏸️ Pausado!');
  }

  if (commandName === 'resume') {
    if (!serverQueue) return interaction.editReply('❌ Nada tocando');
    serverQueue.player.unpause();
    interaction.editReply('▶️ Continuando!');
  }

  if (commandName === 'stop') {
    if (!serverQueue) return interaction.editReply('❌ Nada tocando');

    serverQueue.songs = [];
    serverQueue.player.stop();
    serverQueue.connection.destroy();
    queues.delete(interaction.guild.id);

    interaction.editReply('⛔ Parado!');
  }
});

async function playSong(guild) {
  const serverQueue = queues.get(guild.id);

  if (!serverQueue || !serverQueue.songs.length) {
    if (serverQueue?.connection) serverQueue.connection.destroy();
    queues.delete(guild.id);
    return;
  }

  const song = serverQueue.songs[0];

  try {
    const stream = await play.stream(song.url, {
      discordPlayerCompatibility: true
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type
    });

    serverQueue.player.play(resource);

    serverQueue.player.once(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      playSong(guild);
    });

  } catch (err) {
    console.error(err);
    serverQueue.songs.shift();
    playSong(guild);
  }
}

client.login(process.env.TOKEN);