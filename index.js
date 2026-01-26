const { Client, GatewayIntentBits, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, StringSelectMenuBuilder, AttachmentBuilder } = require("discord.js");
const express = require("express");
const app = express();

/* ================= SERVER ================= */
const PORT = process.env.PORT || 5000;
app.get("/", (req, res) => res.send("Bot is running!"));
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));

/* ================= CLIENT ================= */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/* ================= STATE ================= */
const openTickets = new Map();
const ticketSteps = new Map();
const TICKET_CATEGORY_NAME = "Purchase";

/* ================= TRANSCRIPTS ================= */
const transcriptStore = new Map(); 
// key: ticketChannelId (string) -> { ownerId, ownerTag, transcriptText, createdAt }

/* ================= COLORS ================= */
const COLOR_RED = 0xED4245;
const COLOR_WHITE = 0xFFFFFF;
const COLOR_GREEN = 0x57F287;

/* ================= READY ================= */
client.once("ready", () => {
    console.log("✅ Ticket bot online!");
    
    // Register the /ticketpanel command
    const guild = client.guilds.cache.get('YOUR_GUILD_ID');  // Replace with your server's ID
    if (!guild) return;

    guild.commands.create({
        name: 'ticketpanel',
        description: 'Get the ticket creation panel'
    });
});

/* ================= COMPONENTS ================= */
function buildCloseTicketButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("close_ticket")
            .setLabel("🔒 Close Ticket")
            .setStyle(ButtonStyle.Danger)
    );
}

function buildCategoryButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("category_game")
            .setLabel("Roblox Game")
            .setEmoji({ id: "1464359841974849578" })
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("category_robux")
            .setLabel("Robux")
            .setEmoji({ id: "1464359790565261332" })
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("category_other")
            .setLabel("Other")
            .setEmoji({ id: "1464359760710205614" })
            .setStyle(ButtonStyle.Primary)
    );
}

function buildPaymentSelectMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("payment_method")
            .setPlaceholder("Select a payment method")
            .addOptions(
                { label: "PayPal", value: "paypal", emoji: { id: "1464048968689389588", name: "Paypal" } },
                { label: "Litecoin", value: "litecoin", emoji: { id: "1464048883662328092", name: "Litecoin" } },
                { label: "Solana", value: "solana", emoji: { id: "1464048916889866383", name: "Solana" } },
                { label: "Paysafecard", value: "paysafecard", emoji: { id: "1464048837298491486", name: "Paysafecard" } },
                { label: "iDeal", value: "ideal", emoji: { id: "1464048793677856920", name: "IDeal" } }
            )
    );
}

function buildOtherGameSelectMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("other_game_select")
            .setPlaceholder("Select the game for your purchase")
            .addOptions(
                { label: "Fortnite", value: "Fortnite", emoji: { id: "1464362766285537408" } },
                { label: "Valorant", value: "Valorant", emoji: { id: "1464362719317594205" } },
                { label: "Brawl Stars", value: "BrawlStars", emoji: { id: "1464362661603971258" } },
                { label: "Clash Royale", value: "ClashRoyale", emoji: { id: "1464362602242117774" } }
            )
    );
}

/* ================= UTILITY ================= */
async function deleteLastQuestion(channel, stepData) {
    if (stepData.lastQuestion) {
        const msg = await channel.messages.fetch(stepData.lastQuestion).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
    }
}

/* ================= OPEN TICKET ================= */
async function openTicket(interaction) {
    const user = interaction.user;
    const guild = interaction.guild;

    if (openTickets.has(user.id))
        return interaction.reply({ content: "⚠️ You already have an open ticket.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const category = guild.channels.cache.find(
        c => c.name === TICKET_CATEGORY_NAME && c.type === ChannelType.GuildCategory
    );

    const channel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        type: ChannelType.GuildText,
        parent: category?.id ?? null,
        rateLimitPerUser: 5,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    });

    openTickets.set(user.id, channel.id);
    await interaction.editReply({ content: `✅ Ticket created: ${channel}` });

    // Initial guidelines
    await channel.send({
        content: `<@${user.id}>`,
        embeds: [
            new EmbedBuilder()
                .setTitle("📋 Ticket System Guidelines")
                .setColor(COLOR_RED)
                .setDescription(
                `• Follow the prompts carefully
                • Payment method will be asked, but you will not need to pay directly.
                • Misuse of tickets may result in a ban`
                ),
            new EmbedBuilder()
                .setTitle("📝 How to Place & Claim Your Order")
                .setColor(COLOR_RED)
                .setDescription(
                `• Answer all questions accurately
                • Confirm your order
                • Wait for staff assistance`
                )
        ],
        components: [buildCloseTicketButton()]
    });

    // ASK CATEGORY
    const question = await channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle("What are you looking for? (1/6)")
                .setColor(COLOR_WHITE)
                .setDescription(
                `If the game/item you are looking for is not listed,
                please select **Other** to continue`)
        ],
        components: [buildCategoryButtons()]
    });

    ticketSteps.set(channel.id, {
        userId: user.id,
        flow: null,
        step: null,
        data: {},
        lastQuestion: question.id
    });
}

/* ================= MESSAGE FLOW ================= */
client.on("messageCreate", async message => {
    if (message.author.bot) return;

    // Listen for !ticketpanel command
    if (message.content.toLowerCase() === "!ticketpanel") {
        // Check if the user has the "CommandPerm" role
        if (!message.member.roles.cache.some(role => role.name === "CommandPerm")) {
            return message.reply({
                content: "❌ You do not have permission to use this command.",
                ephemeral: true
            });
        }

        // Send a message with embed to open a ticket
        const ticketPanelEmbed = new EmbedBuilder()
            .setColor(COLOR_WHITE)
            .setTitle("Purchase")  // Updated title
            .setDescription("Click the button below to open a purchase ticket:")  // Updated description
            .setFooter({ text: "trshHangout" })  // Updated footer
            .setTimestamp();

        const ticketPanelMessage = await message.channel.send({
            embeds: [ticketPanelEmbed],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("open_ticket")
                        .setLabel("💸Purchase💸")
                        .setStyle(ButtonStyle.Primary)
                )
            ]
        });

        // Don't delete the message, keep it forever
    }

    // Existing ticket flow code (you can leave it as is)
    if (message.channel.name?.startsWith("ticket-")) {
        const stepData = ticketSteps.get(message.channel.id);
        if (!stepData || stepData.finished || stepData.userId !== message.author.id) return;

        const typingAllowed = stepData.step && !["payment", "confirm_order", "other_game_select"].includes(stepData.step);
        if (!typingAllowed) {
            await message.delete().catch(() => {});
            return;
        }

        await message.delete().catch(() => {});
        await deleteLastQuestion(message.channel, stepData);

        const content = message.content.trim();
        let nextText;

        if (stepData.flow === "game") {
            if (stepData.step === "game_name") {
                stepData.data.game = content;
                stepData.step = "item";
                nextText = `What would you like to purchase in **${content}**?`;
            } else if (stepData.step === "item") {
                stepData.data.item = content;
                stepData.step = "quantity";
                nextText = "How much would you like to purchase?";
            } else if (stepData.step === "quantity") {
                stepData.data.quantity = content;
                stepData.step = "username";
                nextText = "Enter your Roblox username.";
            } else if (stepData.step === "username") {
                stepData.data.username = content;
                stepData.step = "payment";
                const msg = await message.channel.send({
                    embeds: [new EmbedBuilder().setTitle("Select payment method.\nPlease note, PayPal shipping fees are not covered and may vary by country\n(Payment will not be requested directly)").setColor(COLOR_WHITE)],
                    components: [buildPaymentSelectMenu()]
                });
                stepData.lastQuestion = msg.id;
                return;
            }
        }

        if (stepData.flow === "robux") {
            if (stepData.step === "quantity") {
                stepData.data.quantity = content;
                stepData.step = "gamepass";
                nextText = "Please provide your gamepass link (Make sure the gamepass is set to the amount of robux you want to purchase) **Rblx standard fee rate = 30%**";
            } else if (stepData.step === "gamepass") {
                if (!content.startsWith("https://www.roblox.com")) {
                    nextText = "❌ Invalid link. Please provide a valid Roblox gamepass link starting with **https://www.roblox.com**";
                } else {
                    stepData.data.game = "Roblox";
                    stepData.data.item = "Robux";
                    stepData.data.gamepass = content;  // Store the valid gamepass link here
                    stepData.step = "payment";
                    const msg = await message.channel.send({
                        embeds: [new EmbedBuilder().setTitle("Select payment method.\nPlease note, PayPal shipping fees are not covered and may vary by country\n(Payment will not be requested directly)").setColor(COLOR_WHITE)],
                        components: [buildPaymentSelectMenu()]
                    });

                    stepData.lastQuestion = msg.id;
                    return;
                }
            }
        }

        if (stepData.flow === "other") {
            if (stepData.step === "item") {
                stepData.data.item = content;
                stepData.step = "quantity";
                nextText = "How much would you like to buy?";
            } else if (stepData.step === "quantity") {
                stepData.data.quantity = content;
                stepData.step = "payment";
                const msg = await message.channel.send({
                    embeds: [new EmbedBuilder().setTitle("Select payment method.\nPlease note, PayPal shipping fees are not covered and may vary by country\n(Payment will not be requested directly)").setColor(COLOR_WHITE)],
                    components: [buildPaymentSelectMenu()]
                });
                stepData.lastQuestion = msg.id;
                return;
            }
        }

        if (nextText) {
            const msg = await message.channel.send({
                embeds: [new EmbedBuilder().setColor(COLOR_WHITE).setDescription(nextText)]
            });
            stepData.lastQuestion = msg.id;
        }
    }
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {
    const stepData = ticketSteps.get(interaction.channel?.id);

    /* OPEN TICKET BUTTON */
    if (interaction.isButton() && interaction.customId === "open_ticket") {
        return openTicket(interaction);
    }

    /* CATEGORY BUTTONS */
    if (interaction.isButton() && interaction.customId.startsWith("category_")) {
        if (!stepData || stepData.userId !== interaction.user.id)
            return interaction.reply({ content: "❌ Not your ticket.", ephemeral: true });

        await interaction.deferUpdate();
        await deleteLastQuestion(interaction.channel, stepData);

        if (interaction.customId === "category_game") {
            stepData.flow = "game";
            stepData.step = "game_name";
            const msg = await interaction.channel.send({
                embeds: [new EmbedBuilder().setColor(COLOR_WHITE).setDescription("Which Roblox game are you purchasing for?")]
            });
            stepData.lastQuestion = msg.id;
        } else if (interaction.customId === "category_robux") {
            stepData.flow = "robux";
            stepData.step = "quantity";
            const msg = await interaction.channel.send({
                embeds: [new EmbedBuilder().setColor(COLOR_WHITE).setDescription("How much Robux would you like to buy?")]
            });
            stepData.lastQuestion = msg.id;
        } else if (interaction.customId === "category_other") {
            stepData.flow = "other";
            stepData.step = "other_game_select";
            const msg = await interaction.channel.send({
                embeds: [new EmbedBuilder().setColor(COLOR_WHITE).setDescription("Select the game for your purchase:")],
                components: [buildOtherGameSelectMenu()]
            });
            stepData.lastQuestion = msg.id;
        }
    }

    /* OTHER GAME SELECT */
    if (interaction.isStringSelectMenu() && interaction.customId === "other_game_select") {
        if (!stepData || stepData.userId !== interaction.user.id)
            return interaction.reply({ content: "❌ Not your ticket.", ephemeral: true });

        await interaction.deferUpdate();
        await deleteLastQuestion(interaction.channel, stepData);

        stepData.data.game = interaction.values[0];

        // Store emoji
        const selectedOption = interaction.component.options.find(opt => opt.value === interaction.values[0]);
        stepData.data.gameEmoji = selectedOption.emoji;

        stepData.step = "item";
        const msg = await interaction.channel.send({
            embeds: [new EmbedBuilder().setColor(COLOR_WHITE).setDescription("What would you like to buy?")]
        });
        stepData.lastQuestion = msg.id;
    }

    /* PAYMENT SELECT */
    if (interaction.isStringSelectMenu() && interaction.customId === "payment_method") {
        if (!stepData || stepData.userId !== interaction.user.id)
            return interaction.reply({ content: "❌ Not your ticket.", ephemeral: true });

        await interaction.deferUpdate();
        const selectedOption = interaction.component.options.find(opt => opt.value === interaction.values[0]);
        stepData.data.payment = {
            label: selectedOption.label,
            emoji: selectedOption.emoji
        };
        await deleteLastQuestion(interaction.channel, stepData);

        const gameDisplay = stepData.data.gameEmoji
            ? `<:${stepData.data.gameEmoji.name}:${stepData.data.gameEmoji.id}> ${stepData.data.game}`
            : stepData.data.game;

        const paymentDisplay = stepData.data.payment.emoji
            ? `<:${stepData.data.payment.emoji.name}:${stepData.data.payment.emoji.id}>`
            : "";

        let gamepassDisplay = stepData.data.gamepass ? stepData.data.gamepass : "";
        let usernameDisplay = "Username";

        if (stepData.flow === "robux" && stepData.data.gamepass) {
            gamepassDisplay = stepData.data.gamepass;  // Display the actual gamepass link
        } else if (stepData.flow === "robux" && !stepData.data.gamepass) {
            gamepassDisplay = ""; // Remove the extra line when Gamepass is not provided
        }

        if (stepData.flow === "other" || !stepData.data.username) {
            usernameDisplay = "";
        }

        const summaryEmbed = new EmbedBuilder()
            .setTitle("📝 Confirm Your Order")
            .setColor(COLOR_WHITE)
            .setDescription(
                `Game: **${gameDisplay}**\n` +
                `Item: **${stepData.data.item}**\n` +
                `Quantity: **${stepData.data.quantity}**\n` +
                `${usernameDisplay ? `Username: **${stepData.data.username ?? "N/A"}**\n` : ""}` +
                `${gamepassDisplay ? `Gamepass: **${gamepassDisplay}**\n` : ""}` +
                `Payment Method: ${paymentDisplay} **${stepData.data.payment.label}**`
            );

        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("confirm_order").setLabel("Confirm").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("redo_order").setLabel("Redo").setStyle(ButtonStyle.Danger)
        );

        const msg = await interaction.channel.send({ embeds: [summaryEmbed], components: [confirmRow] });
        stepData.lastQuestion = msg.id;
    }

    /* CONFIRM / REDO BUTTONS */
    if (interaction.isButton() && ["confirm_order", "redo_order"].includes(interaction.customId)) {
        if (!stepData || stepData.userId !== interaction.user.id)
            return interaction.reply({ content: "❌ Not your ticket.", ephemeral: true });

        await interaction.deferUpdate();

        if (interaction.customId === "redo_order") {
            await deleteLastQuestion(interaction.channel, stepData);
            stepData.flow = null;
            stepData.step = null;
            stepData.data = {};
            const msg = await interaction.channel.send({
                embeds: [new EmbedBuilder().setColor(COLOR_WHITE).setDescription("Please select a category to start over.")],
                components: [buildCategoryButtons()]
            });
            stepData.lastQuestion = msg.id;
            return;
        }

        if (interaction.customId === "confirm_order") {
            await deleteLastQuestion(interaction.channel, stepData);

            const gameDisplay = stepData.data.gameEmoji
                ? `<:${stepData.data.gameEmoji.name}:${stepData.data.gameEmoji.id}> ${stepData.data.game}`
                : stepData.data.game;

            const paymentDisplay = stepData.data.payment.emoji
                ? `<:${stepData.data.payment.emoji.name}:${stepData.data.payment.emoji.id}>`
                : "";

            await interaction.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("✅ Order Confirmed")
                        .setColor(COLOR_GREEN)
                        .setDescription(
`Your order has been confirmed.

A support team member will assist you shortly.
Do not send payment unless requested by staff`
                        )
                ]
            });

await interaction.channel.send({
    embeds: [
        new EmbedBuilder()
            .setTitle("Final Order Summary")
            .setColor(COLOR_GREEN)
            .setDescription(
                `**Game:**\n` +
                `**${gameDisplay}**\n\n` +  // Game info

                `**Item:**\n` +
                `**${stepData.data.item}**\n\n` +  // Item info

                `**Quantity:**\n` +
                `**${stepData.data.quantity}**\n\n` +  // Quantity info

                `${stepData.data.username ? `**Username:**\n**${stepData.data.username}**\n\n` : ""}` +  // Username info

                `${stepData.data.gamepass ? `**Gamepass:**\n**${stepData.data.gamepass}**\n\n` : ""}` +  // Gamepass link

                `**Payment Method:**\n` +
                `${paymentDisplay} **${stepData.data.payment.label}**`  // Payment info
            )
    ]
});
            stepData.finished = true;
            ticketSteps.delete(interaction.channel.id);
        }
    }

    /* ================= VIEW FULL TRANSCRIPT BUTTON ================= */
    if (interaction.isButton() && interaction.customId.startsWith("view_full_transcript:")) {
        const ticketChannelId = interaction.customId.split(":")[1];
        const saved = transcriptStore.get(ticketChannelId);

        if (!saved) {
            return interaction.reply({
                content: "❌ Transcript not found (it may have been cleared).",
                ephemeral: true
            });
        }

        // Send as .txt file to avoid 2000 char limit
        const file = new AttachmentBuilder(Buffer.from(saved.transcriptText, "utf8"), {
            name: `transcript-${ticketChannelId}.txt`
        });

        return interaction.reply({
            content: `📄 Transcript for **${saved.ownerTag}**`,
            files: [file],
            ephemeral: true
        });
    }

    /* ================= CLOSE TICKET ================= */
    if (interaction.isButton() && interaction.customId === "close_ticket") { 
        await interaction.reply({ 
            content: "⚠️ Are you sure on closing this ticket?", 
            components: [ 
                new ActionRowBuilder().addComponents( 
                    new ButtonBuilder().setCustomId("confirm_close").setLabel("Yes").setStyle(ButtonStyle.Success), 
                    new ButtonBuilder().setCustomId("cancel_close").setLabel("No").setStyle(ButtonStyle.Danger) 
                ) 
            ], 
            ephemeral: true 
        }); 
    }

    if (interaction.isButton() && interaction.customId === "confirm_close") { 
        await interaction.update({ 
            content: "🔒 Closing ticket...", 
            components: [] 
        });

        // Fetch all messages from the ticket channel
        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: 100 }); // Adjust the limit as needed

        // Find the ticket owner by reversing openTickets (userId -> channelId)
        let ownerId = null;
        for (const [uid, cid] of openTickets.entries()) {
            if (cid === channel.id) {
                ownerId = uid;
                break;
            }
        }

        let ownerTag = "Unknown User";
        if (ownerId) {
            const member = await interaction.guild.members.fetch(ownerId).catch(() => null);
            if (member) ownerTag = member.user.tag;
        }

        // Prepare the transcript content
        let transcriptContent = `Ticket closed: <#${channel.id}>\n\n`;
        let fullTranscript = "";  // This will store the full transcript for the button's action

        messages.reverse().forEach(msg => {
            if (msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                    fullTranscript += `**Embed Message**: ${embed.title || "No Title"}\n${embed.description || "No Description"}\n\n`;
                });
            }
            if (msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    fullTranscript += `**Attachment**: [${att.name}](${att.url})\n`;
                });
            }
            if (msg.content) {
                fullTranscript += `**Message**: ${msg.content}\n\n`;
            }
        });

        // Save transcript for the button to retrieve later
        transcriptStore.set(channel.id, {
            ownerId,
            ownerTag,
            transcriptText: fullTranscript || "No messages found.",
            createdAt: Date.now()
        });

        // Embed for the transcript with a button to view full ticket content
        const transcriptEmbed = new EmbedBuilder()
            .setTitle(`Transcript of ${ownerTag}'s Ticket`)
            .setColor(COLOR_GREEN);

        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`view_full_transcript:${channel.id}`)
                .setLabel("View Full Transcript")
                .setStyle(ButtonStyle.Primary)
        );

        // Send the transcript embed with a button to 'ticket-transcripts' channel
        const ticketTranscriptsChannel = interaction.guild.channels.cache.find(ch => ch.name === 'ticket-transcripts'); 
        if (ticketTranscriptsChannel) {
            await ticketTranscriptsChannel.send({ 
                embeds: [transcriptEmbed], 
                components: [buttonRow],
            }); 
        }

        // Delete the open ticket from the map and close the channel after a short delay
        openTickets.forEach((v, k) => v === interaction.channel.id && openTickets.delete(k)); 
        setTimeout(() => interaction.channel.delete().catch(() => {}), 1500); 
    }

    if (interaction.isButton() && interaction.customId === "cancel_close") { 
        await interaction.update({ 
            content: "❌ Cancelled.", 
            components: [] 
        }); 
    }
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
