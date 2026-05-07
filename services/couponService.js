const { Op } = require("sequelize");

const normalizeCode = (value) => String(value ?? "").trim().toUpperCase();
const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

/**
 * Calcula el descuento basándose en si es porcentaje o monto fijo.
 */
const calculateDiscountAmount = (valorDescuento, baseCalculo) => {
  const amount = Number(valorDescuento || 0);
  const subtotalNumber = Number(baseCalculo || 0);

  if (!amount || subtotalNumber <= 0) return 0;

  // Si el valor es entre 1 y 100, asumimos porcentaje (puedes ajustar esta lógica según tu tabla)
  if (amount > 0 && amount <= 100) {
    return roundMoney((subtotalNumber * amount) / 100);
  }
  return roundMoney(amount);
};

const validateCouponForCheckout = async ({
  models,
  userId,
  codigoCupon,
  cartItems = [], // Recibimos los items del carrito para validar productos específicos
  subtotal = 0,
  transaction = null,
  finalize = false,
}) => {
  const code = normalizeCode(codigoCupon);
  if (!code) return null;

  const { Cupon, CuponUsuario, Descuento, DescuentoProducto, Patrocinador } = models;

  // 1. Buscar cupón con su Descuento y Patrocinador
  const coupon = await Cupon.findOne({
    where: { codigo_cupon: { [Op.iLike]: code } },
    include: [
      { model: Descuento },
      { model: Patrocinador }
    ],
    transaction,
  });

  if (!coupon) throw { status: 404, message: "Cupón no encontrado" };
  
  const discount = coupon.Descuento;
  if (!discount) throw { status: 400, message: "El cupón no tiene un descuento asociado" };

  // 2. Validar Fechas (usando la tabla Descuento)
  const now = new Date();
  if (discount.fecha_inicio && now < new Date(discount.fecha_inicio)) {
    throw { status: 400, message: "El cupón todavía no está activo" };
  }
  if (discount.fecha_fin && now > new Date(discount.fecha_fin)) {
    throw { status: 400, message: "El cupón ya expiró" };
  }

  // 3. Validar Usos del Cliente
  const maxUsos = Number(coupon.max_usos_cliente || 0);
  if (maxUsos > 0) {
    const usedCount = await CuponUsuario.count({
      where: { id_usuario: userId, id_descuento: discount.id_descuento, usado_en: { [Op.ne]: null } },
      transaction,
    });
    if (usedCount >= maxUsos) throw { status: 409, message: "Ya alcanzaste el máximo de usos" };
  }

  // 4. LÓGICA DE PRODUCTOS ESPECÍFICOS
  // Buscamos si este descuento está amarrado a productos en 'descuentoproducto'
  const allowedProducts = await DescuentoProducto.findAll({
    where: { id_descuento: discount.id_descuento },
    transaction
  });

  let baseParaDescuento = Number(subtotal);

  if (allowedProducts.length > 0) {
    // Si hay restricciones, sumamos solo los precios de los productos permitidos del carrito
    const idsPermitidos = allowedProducts.map(p => p.id_producto);
    baseParaDescuento = cartItems
      .filter(item => idsPermitidos.includes(item.id_producto))
      .reduce((sum, item) => sum + (Number(item.precio) * Number(item.cantidad)), 0);

    if (baseParaDescuento <= 0) {
      throw { status: 400, message: "Este cupón no aplica a los productos en tu carrito" };
    }
  }

  // 5. Validar Monto Mínimo (sobre la base aplicable)
  if (baseParaDescuento < Number(coupon.monto_minimo_pedido || 0)) {
    throw { status: 400, message: `Monto mínimo no alcanzado para este cupón` };
  }

  const discountAmount = Math.min(calculateDiscountAmount(discount.valor, baseParaDescuento), baseParaDescuento);

  // 6. Finalizar (Quemar cupón)
  if (finalize) {
    await CuponUsuario.create({
      id_usuario: userId,
      id_descuento: discount.id_descuento,
      usado_en: now,
    }, { transaction });
  }

  return {
    coupon: {
      codigo_cupon: coupon.codigo_cupon,
      patrocinador: coupon.Patrocinador?.nombre || null,
      imagen_patrocinador: coupon.Patrocinador?.imagen_url || null,
      tipo_descuento: discount.tipo_descuento,
      valor: Number(discount.valor)
    },
    discountAmount: roundMoney(discountAmount),
  };
};

module.exports = { calculateDiscountAmount, normalizeCode, validateCouponForCheckout };