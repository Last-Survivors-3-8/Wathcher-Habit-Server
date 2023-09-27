const Group = require('../models/Group');
const Notification = require('../models/Notification');
const User = require('../models/User');
const groupService = require('../services/groupService');
const handleError = require('../lib/handleError');
const { ERRORS } = require('../lib/ERRORS');
const connections = require('../utils/sseConnections');

const generateGroup = async (req, res, next) => {
  const { groupName, creatorId } = req.body;

  try {
    const alreadyHasGroup = await Group.exists({ groupName }).exec();

    if (alreadyHasGroup) {
      return handleError(res, ERRORS.GROUP_ALREADY_EXISTS);
    }

    const user = await User.findById(creatorId).exec();

    if (!user) {
      return handleError(res, ERRORS.USER_NOT_FOUND);
    }

    const newGroupColums = {
      groupName,
      members: [creatorId],
    };

    const newGroup = new Group(newGroupColums);
    await newGroup.save();

    user.groups.push(newGroup._id);
    await user.save();

    return res.status(201).json({ newGroup });
  } catch (error) {
    return next(error);
  }
};

const getGroup = async (req, res, next) => {
  const { groupId } = req.params;
  const { userId } = req.query;

  try {
    const group = await Group.findById(groupId).lean().exec();
    const isMember = group.members
      .map((memberId) => memberId.toString())
      .includes(userId);

    if (!group) {
      return handleError(res, ERRORS.GROUP_NOT_FOUND);
    }

    return res.status(200).json({ group, isMember });
  } catch (error) {
    return next(error);
  }
};

const addMember = async (req, res, next) => {
  const { groupId } = req.params;
  const { userId } = req.body;

  try {
    const group = await Group.findById(groupId).exec();

    if (!group) {
      return handleError(res, ERRORS.GROUP_NOT_FOUND);
    }

    const user = await User.findById(userId).exec();

    if (!user) {
      return handleError(res, ERRORS.USER_NOT_FOUND);
    }

    if (group.members.includes(userId)) {
      return handleError(res, ERRORS.USER_ALREADY_IN_GROUP);
    }

    group.members.push(userId);
    await group.save();

    user.groups.push(groupId);
    await user.save();

    await Notification.updateOne(
      {
        groupId,
        status: 'invite',
        isNeedToSend: true,
      },
      {
        $set: { isNeedToSend: false },
      },
    );

    return res
      .status(200)
      .json({ message: '가입되었습니다.', groupId: group._id });
  } catch (error) {
    return next(error);
  }
};

const getGroupDailyHabitList = async (req, res, next) => {
  try {
    const memberDailyHabits = await groupService.getMemberDailyHabits(req);

    return res.status(200).json({ data: memberDailyHabits });
  } catch (error) {
    return next(error);
  }
};

const inviteMember = async (req, res, next) => {
  const { groupId } = req.params;
  const { fromUserId, toUserId } = req.body;

  try {
    const group = await Group.findById(groupId).exec();

    if (!group) {
      return handleError(res, ERRORS.GROUP_NOT_FOUND);
    }

    const fromUser = await User.findById(fromUserId).exec();
    const toUser = await User.findById(toUserId).exec();

    if (!fromUser || !toUser) {
      return handleError(res, ERRORS.USER_NOT_FOUND);
    }

    if (!group.members.includes(fromUserId)) {
      return handleError(res, ERRORS.FROM_USER_NOT_IN_GROUP);
    }

    if (group.members.includes(toUserId)) {
      return handleError(res, ERRORS.USER_ALREADY_IN_GROUP);
    }

    await Notification.updateMany(
      {
        to: toUserId,
        groupId,
        status: 'invite',
      },
      {
        isNeedToSend: false,
      },
    );

    const notification = new Notification({
      content: `${fromUser.nickname}님이 그룹에 초대하였습니다. ${group.groupName}`,
      from: fromUserId,
      to: toUserId,
      groupId,
      status: 'invite',
    });

    await notification.save();

    if (connections[toUserId]) {
      connections[toUserId].write(`data: ${JSON.stringify(notification)}\n\n`);
    }

    return res
      .status(200)
      .json({ message: '성공적으로 초대 알림을 보냈습니다.' });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getGroupDailyHabitList,
  getGroup,
  addMember,
  generateGroup,
  inviteMember,
};
